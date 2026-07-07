// Run provenance (reproducibility recipe): every agent experiment execution —
// a bash command that runs code — appends a run record to
// <workspace>/.openscience/runs.jsonl: the command, code version (entry scripts
// hashed), environment + hardware, and the files it produced. Complements
// provenance.jsonl (authored file text); a run-produced file's provenance
// version carries this run's id, so an artifact links back to its recipe.
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::provenance::{capture_env, content_hash, EnvInfo, ProvenanceState};
use crate::runtime::workspace_dir;

const STORE_DIR: &str = ".openscience";
const RUNS_FILE: &str = "runs.jsonl";
const LOGS_DIR: &str = "logs";
/// Captured stdout/stderr is capped like provenance content.
const LOG_CAP: usize = 200_000;
/// Files larger than this are recorded by path+size only (not hashed) — hashing
/// a multi-GB checkpoint on every run would stall the scan.
const HASH_CAP: u64 = 5_000_000;
/// Bound the workspace scan so a huge output tree can't hang a run record.
const WALK_CAP: usize = 50_000;
/// Cap outputs per run so one command that rewrites a whole tree stays bounded.
const OUTPUT_CAP: usize = 200;

/// Serializes appends so two run events can't interleave lines.
#[derive(Default)]
pub struct RunState(pub Mutex<()>);

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub run_id: String,
    pub ts: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub command: String,
    /// Compute surface: "local" | "hpc" | "modal" | "jupyter". Absent = local.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    /// "ok" | "failed".
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wall_ms: Option<u64>,
    /// Entry scripts named on the command line, hashed — code version.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub code: Vec<RunArtifact>,
    /// Files created/modified during the run's time window — its outputs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outputs: Vec<RunArtifact>,
    /// Captured stdout/stderr, content-addressed to `.openscience/logs/<hash>.txt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<EnvInfo>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunArtifact {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    pub size: u64,
}

/// Directories never worth scanning for outputs (VCS, our store, caches, envs).
fn is_ignored_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | STORE_DIR | "node_modules" | ".venv" | "venv" | "__pycache__" | ".ipynb_checkpoints"
    ) || name.starts_with('.')
}

/// Files that are never meaningful run outputs (caches, OS cruft).
fn is_ignored_file(name: &str) -> bool {
    name == ".DS_Store" || name.ends_with(".pyc") || name.ends_with(".pyo")
}

/// Hash a file's bytes (capped) and return (hash, size). Large files record
/// size only. Unreadable files return (None, 0).
fn hash_file(path: &Path) -> (Option<String>, u64) {
    let Ok(meta) = std::fs::metadata(path) else {
        return (None, 0);
    };
    let size = meta.len();
    if size > HASH_CAP {
        return (None, size);
    }
    match std::fs::read(path) {
        Ok(bytes) => (Some(hash_bytes(&bytes)), size),
        Err(_) => (None, size),
    }
}

/// A short, deterministic hash of arbitrary bytes (mirrors provenance's text hash).
fn hash_bytes(bytes: &[u8]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// A workspace-relative `/`-joined key for a path under `root`, or None if it
/// escapes the workspace.
fn rel_key(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

/// Source-code file extensions — the entry script the interpreter runs. Data
/// files named as arguments (`.csv`, `.json`, a checkpoint) are NOT code, so
/// they're never pulled out of the run's outputs.
fn is_source_file(name: &str) -> bool {
    matches!(
        name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref(),
        Some("py" | "r" | "jl" | "sh" | "ipynb" | "rmd" | "qmd")
    )
}

/// The entry script named on the command line (the first source file that
/// exists under `root`), hashed — pins the code version so a later edit is
/// detectable. Only the first is taken: a second file is typically an output
/// (e.g. papermill's `out.ipynb`) or a data argument, not code.
pub fn parse_code_files(command: &str, root: &Path) -> Vec<RunArtifact> {
    for raw in command.split_whitespace() {
        let tok = raw.trim_matches(|c| c == '"' || c == '\'');
        if tok.is_empty() || tok.starts_with('-') || !is_source_file(tok) {
            continue;
        }
        // Strip a leading `./` so the join doesn't leave a CurDir component that
        // rel_key would reject (`./run.sh`, `python ./train.py`).
        let candidate = root.join(tok.strip_prefix("./").unwrap_or(tok));
        if !candidate.is_file() {
            continue;
        }
        if let Some(key) = rel_key(root, &candidate) {
            let (hash, size) = hash_file(&candidate);
            return vec![RunArtifact { path: key, hash, size }];
        }
    }
    Vec::new()
}

/// Files created or modified in the window [start_ms, end_ms] — a run's
/// outputs. Millisecond precision (so a file written a fraction of a second
/// before the command started isn't over-attributed). Bounded, ignoring
/// VCS/store/cache dirs and cache files.
pub fn changed_outputs(root: &Path, start_ms: u64, end_ms: u64) -> Vec<RunArtifact> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut visited = 0usize;
    // A small grace so a file flushed just after the reported end still counts.
    let end = end_ms + 1000;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if visited >= WALK_CAP || out.len() >= OUTPUT_CAP {
                return out;
            }
            visited += 1;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if !is_ignored_dir(&name) {
                    stack.push(path);
                }
                continue;
            }
            if is_ignored_file(&name) {
                continue;
            }
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            if mtime_ms >= start_ms && mtime_ms <= end {
                if let Some(key) = rel_key(root, &path) {
                    let (hash, size) = hash_file(&path);
                    out.push(RunArtifact { path: key, hash, size });
                }
            }
        }
    }
    out
}

/// A deterministic run id from the command and start time (millisecond
/// precision, so identical commands seconds apart get distinct ids).
fn run_id(command: &str, start_ms: u64) -> String {
    format!("run_{}", content_hash(&format!("{start_ms}:{command}")))
}

fn runs_file(root: &Path) -> PathBuf {
    root.join(STORE_DIR).join(RUNS_FILE)
}

/// Write captured stdout/stderr to a content-addressed log file, returning its
/// hash. Capped like provenance content.
fn write_log(root: &Path, log: &str) -> Option<String> {
    let mut text = log.to_string();
    if text.len() > LOG_CAP {
        let mut end = LOG_CAP;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n… [truncated]");
    }
    let hash = content_hash(&text);
    let dir = root.join(STORE_DIR).join(LOGS_DIR);
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{hash}.txt"));
    if !path.exists() {
        std::fs::write(&path, &text).ok()?;
    }
    Some(hash)
}

fn append_run(root: &Path, record: &RunRecord) -> Result<(), String> {
    let file = runs_file(root);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("runs dir failed: {e}"))?;
    }
    let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| format!("runs open failed: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("runs write failed: {e}"))?;
    Ok(())
}

/// Read a content-addressed run log (`.openscience/logs/<hash>.txt`). `hash` is
/// validated to hex so it cannot escape the logs directory.
pub fn read_log(root: &Path, hash: &str) -> Result<String, String> {
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid log id".into());
    }
    let path = root.join(STORE_DIR).join(LOGS_DIR).join(format!("{hash}.txt"));
    std::fs::read_to_string(&path).map_err(|e| format!("log unavailable: {e}"))
}

/// All recorded runs, newest first. Unparseable lines are skipped.
pub fn read_runs(root: &Path) -> Vec<RunRecord> {
    let Ok(text) = std::fs::read_to_string(runs_file(root)) else {
        return Vec::new();
    };
    let mut v: Vec<RunRecord> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    v.reverse();
    v
}

/// Build and store a run record, linking each output file back to the run in
/// provenance. `env` is captured by the caller (kept as a param so the core is
/// testable without shelling out to pip/nvidia-smi).
#[allow(clippy::too_many_arguments)]
pub fn record_run_inner(
    root: &Path,
    command: &str,
    log: Option<&str>,
    started_ms: Option<u64>,
    ended_ms: Option<u64>,
    status: &str,
    surface: Option<String>,
    session_id: Option<String>,
    model: Option<String>,
    env: Option<EnvInfo>,
) -> Result<RunRecord, String> {
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let start_ms = started_ms.unwrap_or(now_ms);
    let ts = start_ms / 1000;
    // Millisecond precision so two identical commands a second apart don't
    // collide on the same run id.
    let run_id = run_id(command, start_ms);

    let code = parse_code_files(command, root);
    // Outputs need a time window; without one we can't attribute files.
    let code_paths: std::collections::HashSet<&str> = code.iter().map(|c| c.path.as_str()).collect();
    let outputs: Vec<RunArtifact> = match (started_ms, ended_ms) {
        (Some(s), Some(e)) => changed_outputs(root, s, e),
        _ => Vec::new(),
    }
    .into_iter()
    // The entry scripts are inputs, not outputs — even when freshly written.
    .filter(|o| !code_paths.contains(o.path.as_str()))
    .collect();
    let wall_ms = match (started_ms, ended_ms) {
        (Some(s), Some(e)) if e >= s => Some(e - s),
        _ => None,
    };
    let log_hash = log.filter(|l| !l.is_empty()).and_then(|l| write_log(root, l));

    let record = RunRecord {
        run_id: run_id.clone(),
        ts,
        session_id: session_id.clone(),
        model: model.clone(),
        command: command.to_string(),
        surface,
        status: status.to_string(),
        wall_ms,
        code,
        outputs: outputs.clone(),
        log_hash,
        env: env.clone(),
    };
    append_run(root, &record)?;

    // Link the produced files to this run in provenance (their lineage shows
    // "produced by run X" + the reproduce recipe) — but only for a run that
    // SUCCEEDED. A failed run's partial/corrupt files are not trustworthy
    // artifacts, so they don't get a "run"-produced version. Best-effort.
    if status == "ok" && !outputs.is_empty() {
        let paths: Vec<String> = outputs.iter().map(|o| o.path.clone()).collect();
        let _ = crate::provenance::link_run_outputs(
            root,
            &paths,
            session_id.clone(),
            model.clone(),
            Some(command.to_string()),
            env.clone(),
            run_id.clone(),
        );
    }
    Ok(record)
}

/// `async`: capture_env shells out (pip freeze, nvidia-smi) and the output scan
/// walks the workspace — neither may run on the UI thread.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn record_run(
    app: AppHandle,
    state: tauri::State<RunState>,
    prov_state: tauri::State<ProvenanceState>,
    command: String,
    log: Option<String>,
    started_at: Option<u64>,
    ended_at: Option<u64>,
    status: String,
    surface: Option<String>,
    session_id: Option<String>,
    model: Option<String>,
) -> Result<RunRecord, String> {
    let root = workspace_dir(&app)?;
    // Capture the environment BEFORE taking any lock: the first call shells out
    // to pip freeze / nvidia-smi (seconds), and it writes only the (idempotent,
    // content-addressed) env lockfile — not provenance.jsonl — so holding the
    // provenance lock across it would needlessly block concurrent writes.
    let env = capture_env(&root, app.package_info().version.to_string());
    // Now hold RunState (serializes runs.jsonl) AND ProvenanceState (serializes
    // provenance.jsonl, shared with record_provenance) — record_run writes both
    // stores. Only this path takes both, always in this order, so no deadlock.
    let _guard = state.0.lock().map_err(|_| "run lock poisoned")?;
    let _prov_guard = prov_state.0.lock().map_err(|_| "provenance lock poisoned")?;
    record_run_inner(
        &root,
        &command,
        log.as_deref(),
        started_at,
        ended_at,
        &status,
        surface,
        session_id,
        model,
        Some(env),
    )
}

/// `async`: reads the whole (unbounded) runs store off the UI thread.
#[tauri::command(async)]
pub fn list_runs(app: AppHandle) -> Result<Vec<RunRecord>, String> {
    Ok(read_runs(&workspace_dir(&app)?))
}

/// Read a run's captured stdout/stderr by its log hash.
#[tauri::command(async)]
pub fn read_run_log(app: AppHandle, hash: String) -> Result<String, String> {
    read_log(&workspace_dir(&app)?, &hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ai4s-runs-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_the_entry_script_from_the_command() {
        let root = temp_root("code");
        std::fs::write(root.join("train.py"), "print('hi')").unwrap();
        std::fs::write(root.join("results.csv"), "a,b\n").unwrap();

        // The entry script is captured (hashed); a data file named as an
        // argument (e.g. an output path) is NOT misclassified as code.
        let code = parse_code_files("python train.py --lr 3e-4 --out results.csv", &root);
        let paths: Vec<_> = code.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(paths, vec!["train.py"]);
        assert!(code[0].hash.is_some()); // small file is hashed
        assert!(code[0].size > 0);

        // Only the first source file is the entry (papermill's 2nd .ipynb is an
        // output, not code).
        std::fs::write(root.join("in.ipynb"), "{}").unwrap();
        std::fs::write(root.join("out.ipynb"), "{}").unwrap();
        let nb = parse_code_files("papermill in.ipynb out.ipynb", &root);
        assert_eq!(nb.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), vec!["in.ipynb"]);

        // Flags, data files, and non-existent tokens are not entry scripts.
        assert!(parse_code_files("python nonexistent.py --lr 3e-4", &root).is_empty());
        assert!(parse_code_files("cat results.csv", &root).is_empty());

        // A `./`-prefixed script (common: `./run.sh`, `python ./train.py`) is
        // captured, not dropped by the leading CurDir path component.
        std::fs::write(root.join("run.sh"), "echo hi").unwrap();
        assert_eq!(
            parse_code_files("./run.sh --flag", &root).iter().map(|c| c.path.as_str()).collect::<Vec<_>>(),
            vec!["run.sh"],
        );
        assert_eq!(
            parse_code_files("python ./train.py", &root).iter().map(|c| c.path.as_str()).collect::<Vec<_>>(),
            vec!["train.py"],
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn detects_only_files_modified_in_the_window() {
        let root = temp_root("window");
        std::fs::write(root.join("result.csv"), "a,b\n1,2\n").unwrap();
        std::fs::create_dir_all(root.join(".openscience")).unwrap();
        std::fs::write(root.join(".openscience/ignore.txt"), "x").unwrap();
        std::fs::write(root.join("cache.pyc"), "x").unwrap();

        // A window in the distant past (ms) excludes just-created files.
        assert!(changed_outputs(&root, 1_000, 2_000).is_empty());

        // A window up to now (ms) includes the fresh file — but never the store
        // dir or cache files.
        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
        let outs = changed_outputs(&root, 0, now_ms);
        let paths: Vec<_> = outs.iter().map(|o| o.path.as_str()).collect();
        assert!(paths.contains(&"result.csv"));
        assert!(!paths.iter().any(|p| p.starts_with(".openscience")));
        assert!(!paths.iter().any(|p| p.ends_with(".pyc")));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn records_a_run_and_links_its_outputs_in_provenance() {
        use crate::provenance::versions_for;
        let root = temp_root("record");
        std::fs::write(root.join("train.py"), "print(1)").unwrap();

        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        // Window: [now-5s, now+5s] in ms, so the fresh metrics.json is an output.
        std::fs::write(root.join("metrics.json"), "{\"acc\":0.9}").unwrap();
        let rec = record_run_inner(
            &root,
            "python train.py --lr 3e-4",
            Some("epoch 1\nacc 0.9\n"),
            Some((now - 5) * 1000),
            Some((now + 5) * 1000),
            "ok",
            Some("local".into()),
            Some("ses_1".into()),
            Some("kimi".into()),
            None,
        )
        .unwrap();

        assert!(rec.run_id.starts_with("run_"));
        assert_eq!(rec.status, "ok");
        assert_eq!(rec.surface.as_deref(), Some("local"));
        assert_eq!(rec.wall_ms, Some(10_000));
        assert_eq!(rec.code.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), vec!["train.py"]);
        assert!(rec.outputs.iter().any(|o| o.path == "metrics.json"));
        // The entry script is an input (code), never counted as its own output,
        // even though it was written just before (and so is inside the window).
        assert!(!rec.outputs.iter().any(|o| o.path == "train.py"));
        assert!(rec.log_hash.is_some());

        // The run is in the store, newest first.
        let runs = read_runs(&root);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].run_id, rec.run_id);

        // The produced file's provenance version links back to the run.
        let prov = versions_for(&root, "metrics.json").unwrap();
        assert_eq!(prov.len(), 1);
        assert_eq!(prov[0].tool, "run");
        assert_eq!(prov[0].run_id.as_deref(), Some(rec.run_id.as_str()));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn captured_log_round_trips_and_rejects_bad_ids() {
        let root = temp_root("log");
        let hash = write_log(&root, "epoch 1\nacc 0.9\n").expect("log written");
        assert_eq!(read_log(&root, &hash).unwrap(), "epoch 1\nacc 0.9\n");
        // A non-hex id can't escape the logs directory.
        assert!(read_log(&root, "../secret").is_err());
        assert!(read_log(&root, "").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_failed_run_records_the_run_but_does_not_link_its_outputs() {
        use crate::provenance::versions_for;
        let root = temp_root("failed");
        std::fs::write(root.join("train.py"), "print(1)").unwrap();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        std::fs::write(root.join("partial.json"), "{").unwrap(); // partial/corrupt

        let rec = record_run_inner(
            &root,
            "python train.py",
            Some("Traceback…"),
            Some((now - 5) * 1000),
            Some((now + 5) * 1000),
            "failed",
            Some("local".into()),
            None,
            None,
            None,
        )
        .unwrap();

        // The run itself is recorded (a failed experiment is still provenance)…
        assert_eq!(rec.status, "failed");
        assert_eq!(read_runs(&root).len(), 1);
        // …but its partial output is NOT stamped "produced by run" in provenance.
        assert!(versions_for(&root, "partial.json").unwrap().is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn run_id_is_deterministic_for_same_command_and_time() {
        assert_eq!(run_id("python x.py", 100), run_id("python x.py", 100));
        assert_ne!(run_id("python x.py", 100), run_id("python x.py", 101));
        assert_ne!(run_id("python x.py", 100), run_id("python y.py", 100));
    }
}
