// Artifact provenance (P0-3) — Tauri wrappers over shell_core::provenance.
// Every agent write of a workspace file appends a version record to
// <workspace>/.openscience/provenance.jsonl (append-only, one JSON object per
// line), so any artifact can reveal its generating code, environment, and
// originating conversation, per version.
use tauri::AppHandle;

pub use shell_core::provenance::ProvenanceState;
use shell_core::provenance::{self, EnvInfo, ProvenanceRecord};

use crate::runtime::workspace_dir;

/// Capture the environment with the kernel's interpreter resolution, so the
/// recorded Python matches what agent code actually runs on.
pub(crate) fn capture_env(app: &AppHandle, root: &std::path::Path) -> EnvInfo {
    let python = crate::kernel::python_bin(app).ok().map(|(p, _)| p);
    provenance::capture_env(python.as_deref(), root, &app.package_info().version.to_string())
}

/// `async`: fired on every agent write; the first call shells out to
/// `pip freeze` (seconds) and every call re-reads the whole store — none of
/// which may run on the UI thread.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn record_provenance(
    app: AppHandle,
    state: tauri::State<ProvenanceState>,
    path: String,
    tool: String,
    session_id: Option<String>,
    model: Option<String>,
    content: Option<String>,
    diff: Option<String>,
    log: Option<String>,
) -> Result<ProvenanceRecord, String> {
    let _guard = state.0.lock().map_err(|_| "provenance lock poisoned")?;
    let root = workspace_dir(&app)?;
    let env = capture_env(&app, &root);
    // Writes are authored, not runs — no run_id here (runs.rs sets it for
    // files produced by executing code).
    let record = provenance::append_record(&root, &path, &tool, session_id, model, content, diff, log, Some(env), None)?;
    drop(_guard);
    shell_core::git_snapshot::commit_best_effort(&root, &format!("Record {}", record.path));
    Ok(record)
}

/// `async`: reads the whole (unbounded) store off the UI thread.
#[tauri::command(async)]
pub fn list_provenance(app: AppHandle, path: String) -> Result<Vec<ProvenanceRecord>, String> {
    provenance::versions_for(&workspace_dir(&app)?, &path)
}

/// Read a content-addressed package lockfile (`.openscience/env/<hash>.txt`).
/// `hash` is validated to hex so it cannot escape the env directory.
#[tauri::command]
pub fn read_env_lockfile(app: AppHandle, hash: String) -> Result<String, String> {
    provenance::read_env_lockfile(&workspace_dir(&app)?, &hash)
}
