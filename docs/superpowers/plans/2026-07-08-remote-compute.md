# Remote compute over SSH — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the Slurm-only "Cluster (HPC)" feature into "Remote compute" — connect any reachable SSH machine (CPU or GPU, Slurm optional), show its capabilities + a usage snapshot, and let the agent run/monitor/cancel/fetch jobs on it.

**Architecture:** A Rust module (`compute.rs`, renamed from `hpc.rs`) probes a host in one SSH round-trip and manages a `compute.json` machine list; Tauri commands expose it; a React `RemoteComputeCard` lists machines with capability chips + expandable detail; the agent's `remote-compute` skill (renamed from `hpc-slurm`) picks a machine and runs jobs directly (detached `setsid`+PID) or via Slurm.

**Tech Stack:** Rust (Tauri 2, `tauri-plugin-shell` for `ssh`), TypeScript/React (Zustand, Vitest, Testing Library), Python (skill helper).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-remote-compute-design.md`.
- SSH only via the system `ssh`/`scp` with the user's own keys; `-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=yes`. Never handle credentials; never install anything remote.
- All hosts validated by `is_safe_host`; job ids by `is_safe_job_id` (both already in the module).
- Capabilities probed live every time; only the small static `caps` (cores, mem_total, gpu names, slurm) is cached in `compute.json` for agent machine-selection. Never cache time-varying usage.
- Config file `.openscience/compute.json`; migrate a legacy `.openscience/hpc.json` on first read then delete it.
- Every commit must leave `cargo test` (in `apps/desktop/src-tauri`) and `pnpm --dir apps/desktop test`/`tsc` green.
- Rust tests run with `cargo test` from `apps/desktop/src-tauri`. Frontend from `apps/desktop`: `npx vitest run <file>`, `npx tsc --noEmit -p tsconfig.json`, `npx eslint <file>`.

---

### Task 1: Rename `hpc.rs` → `compute.rs` (module only, no behavior change)

Renaming the Rust module does NOT change Tauri command names (those are the `#[tauri::command]` fn names), so the current `ClusterCard` keeps working throughout.

**Files:**
- Rename: `apps/desktop/src-tauri/src/hpc.rs` → `apps/desktop/src-tauri/src/compute.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs:7` (`mod hpc;`) and `:92-97` (`hpc::` → `compute::`)

**Interfaces:**
- Produces: module `compute` exporting the existing `run_ssh`, `is_safe_host`, `is_safe_job_id`, `parse_squeue`, `HpcJob`, `hpc_check`, `hpc_jobs`, `hpc_cancel`, `hpc_config`, `set_hpc_config`, `list_ssh_hosts` (names unchanged).

- [ ] **Step 1: Rename the file**

Run:
```bash
cd apps/desktop/src-tauri
git mv src/hpc.rs src/compute.rs
```

- [ ] **Step 2: Update the module declaration**

In `apps/desktop/src-tauri/src/lib.rs`, change line 7:
```rust
mod compute;
```
(Keep the alphabetical position; it now sits between `artifact_file`/`debug_log`… — move the line so the list stays sorted: place `mod compute;` right after `mod artifact_file;`/`mod debug_log;`/`mod examples;`/`mod harness;` block, i.e. before `mod jupyter;`. Remove the old `mod hpc;` line.)

- [ ] **Step 3: Update the command registrations**

In `apps/desktop/src-tauri/src/lib.rs`, change the six lines `hpc::…` to `compute::…`:
```rust
            compute::list_ssh_hosts,
            compute::hpc_config,
            compute::set_hpc_config,
            compute::hpc_check,
            compute::hpc_jobs,
            compute::hpc_cancel,
```

- [ ] **Step 4: Build and test**

Run:
```bash
cd apps/desktop/src-tauri && cargo test --lib compute 2>&1 | tail -20 && cargo build 2>&1 | tail -5
```
Expected: builds; the moved tests (`parses_hosts_and_skips_wildcards`, `accepts_real_hosts_rejects_injection`, `job_id_validation`, `parses_squeue_lines_name_last`) PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(compute): rename hpc module to compute (no behavior change)"
```

---

### Task 2: Probe types + parser (pure function, TDD)

**Files:**
- Modify: `apps/desktop/src-tauri/src/compute.rs` (add types + `parse_probe` + tests)

**Interfaces:**
- Produces:
  - `pub struct GpuInfo { pub name: String, pub mem_total_mib: u64, pub mem_used_mib: u64, pub util_pct: u32 }`
  - `pub struct ComputeProbe { pub reachable: bool, pub message: Option<String>, pub os: Option<String>, pub cores: Option<u32>, pub load1: Option<f32>, pub mem_total_bytes: Option<u64>, pub mem_avail_bytes: Option<u64>, pub disk_total_bytes: Option<u64>, pub disk_free_bytes: Option<u64>, pub gpus: Vec<GpuInfo>, pub slurm: Option<String> }`
  - `fn parse_probe(stdout: &str) -> ComputeProbe` — sets everything EXCEPT `reachable`/`message`.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` in `compute.rs` (and import `parse_probe`, `ComputeProbe` in the `use super::…` line):
```rust
    #[test]
    fn parses_probe_all_tokens_and_ignores_noise() {
        let out = "\
Welcome to Ubuntu 22.04 — banner line, ignore me
OS Linux 6.5.0-14-generic
CORES 16
LOAD 1.23
MEMTOTAL 67516000000
MEMAVAIL 51000000000
DISKTOTAL 2000000000000
DISKFREE 1200000000000
SLURM slurm 23.11.4
GPU NVIDIA GeForce RTX 3090, 24576, 8100, 40
GPU NVIDIA GeForce RTX 3090, 24576, 512, 0
random junk with no leading token space? nope
";
        let p = super::parse_probe(out);
        assert_eq!(p.os.as_deref(), Some("Linux 6.5.0-14-generic"));
        assert_eq!(p.cores, Some(16));
        assert_eq!(p.load1, Some(1.23));
        assert_eq!(p.mem_total_bytes, Some(67_516_000_000));
        assert_eq!(p.mem_avail_bytes, Some(51_000_000_000));
        assert_eq!(p.disk_total_bytes, Some(2_000_000_000_000));
        assert_eq!(p.disk_free_bytes, Some(1_200_000_000_000));
        assert_eq!(p.slurm.as_deref(), Some("slurm 23.11.4"));
        assert_eq!(p.gpus.len(), 2);
        assert_eq!(p.gpus[0].name, "NVIDIA GeForce RTX 3090");
        assert_eq!(p.gpus[0].mem_total_mib, 24576);
        assert_eq!(p.gpus[0].mem_used_mib, 8100);
        assert_eq!(p.gpus[0].util_pct, 40);
        // reachable/message are set by the command, not the parser.
        assert!(!p.reachable);
    }

    #[test]
    fn parses_probe_missing_tools_degrade() {
        // A minimal CPU box: no SLURM, no GPU, no /proc/loadavg line emitted.
        let p = super::parse_probe("OS Linux 5.10\nCORES 8\nMEMTOTAL 33000000000\n");
        assert_eq!(p.cores, Some(8));
        assert!(p.slurm.is_none());
        assert!(p.gpus.is_empty());
        assert!(p.load1.is_none());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test --lib compute::tests::parses_probe 2>&1 | tail -20`
Expected: FAIL — `parse_probe`/`ComputeProbe` not found.

- [ ] **Step 3: Implement types + parser**

Add near the top of `compute.rs` (after the existing `HpcJob` struct):
```rust
/// One GPU as `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` prints
/// it (memory in MiB, utilization in %).
#[derive(Clone, serde::Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub mem_total_mib: u64,
    pub mem_used_mib: u64,
    pub util_pct: u32,
}

/// One SSH probe of a machine: reachability + static identity + a live usage
/// snapshot, all from a single round-trip. Absent fields = the tool wasn't
/// present (a minimal CPU box has no `nvidia-smi`, an old `free` has no
/// "available" column, etc.).
#[derive(Clone, serde::Serialize, Default)]
pub struct ComputeProbe {
    pub reachable: bool,
    pub message: Option<String>,
    pub os: Option<String>,
    pub cores: Option<u32>,
    pub load1: Option<f32>,
    pub mem_total_bytes: Option<u64>,
    pub mem_avail_bytes: Option<u64>,
    pub disk_total_bytes: Option<u64>,
    pub disk_free_bytes: Option<u64>,
    pub gpus: Vec<GpuInfo>,
    pub slurm: Option<String>,
}

/// Parse the token-labeled probe output (see PROBE_SCRIPT). Each recognized
/// line is `TOKEN value`; unknown lines (shell banners, stray output) are
/// ignored so a chatty login shell can't corrupt the result. Sets everything
/// except `reachable`/`message` (the command decides those from the ssh exit).
fn parse_probe(stdout: &str) -> ComputeProbe {
    let mut p = ComputeProbe::default();
    for line in stdout.lines() {
        let line = line.trim();
        let Some((tag, rest)) = line.split_once(' ') else { continue };
        let rest = rest.trim();
        match tag {
            "OS" => p.os = Some(rest.to_string()),
            "CORES" => p.cores = rest.parse().ok(),
            "LOAD" => p.load1 = rest.parse().ok(),
            "MEMTOTAL" => p.mem_total_bytes = rest.parse().ok(),
            "MEMAVAIL" => p.mem_avail_bytes = rest.parse().ok(),
            "DISKTOTAL" => p.disk_total_bytes = rest.parse().ok(),
            "DISKFREE" => p.disk_free_bytes = rest.parse().ok(),
            "SLURM" => p.slurm = Some(rest.to_string()),
            "GPU" => {
                let f: Vec<&str> = rest.split(',').map(|s| s.trim()).collect();
                if f.len() == 4 {
                    p.gpus.push(GpuInfo {
                        name: f[0].to_string(),
                        mem_total_mib: f[1].parse().unwrap_or(0),
                        mem_used_mib: f[2].parse().unwrap_or(0),
                        util_pct: f[3].parse().unwrap_or(0),
                    });
                }
            }
            _ => {}
        }
    }
    p
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test --lib compute::tests::parses_probe 2>&1 | tail -20`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(compute): probe types + token-labeled parser"
```

---

### Task 3: Machine model + `compute.json` read/migration (TDD)

**Files:**
- Modify: `apps/desktop/src-tauri/src/compute.rs` (add types + pure helpers + tests)

**Interfaces:**
- Produces:
  - `pub struct Caps { pub cores: Option<u32>, pub mem_total_bytes: Option<u64>, pub gpus: Vec<String>, pub slurm: Option<String> }`
  - `pub struct Machine { pub host: String, pub label: Option<String>, pub caps: Option<Caps> }`
  - `fn parse_machines(json: &str) -> Vec<Machine>` — tolerant (bad JSON → empty).
  - `fn legacy_to_machines(hpc_json: &str) -> Vec<Machine>` — `{"host":"x"}` → one machine.
  - `fn upsert_machine(list: &mut Vec<Machine>, host: &str, label: Option<String>)` — dedupe by host.
  - `fn caps_from_probe(p: &ComputeProbe) -> Caps`.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` (extend the `use super::…` import with `parse_machines, legacy_to_machines, upsert_machine, Machine`):
```rust
    #[test]
    fn parses_machines_with_caps() {
        let json = r#"{"machines":[{"host":"home-3090","label":"8x3090",
            "caps":{"cores":16,"mem_total_bytes":67516000000,
                    "gpus":["RTX 3090","RTX 3090"],"slurm":null}}]}"#;
        let m = super::parse_machines(json);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].host, "home-3090");
        assert_eq!(m[0].label.as_deref(), Some("8x3090"));
        assert_eq!(m[0].caps.as_ref().unwrap().gpus.len(), 2);
    }

    #[test]
    fn parse_machines_tolerates_garbage() {
        assert!(super::parse_machines("not json").is_empty());
        assert!(super::parse_machines("{}").is_empty());
    }

    #[test]
    fn migrates_legacy_single_host() {
        let m = super::legacy_to_machines(r#"{"host":"login-a"}"#);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].host, "login-a");
        assert!(m[0].caps.is_none());
        // A legacy file with no host → nothing to migrate.
        assert!(super::legacy_to_machines("{}").is_empty());
    }

    #[test]
    fn upsert_dedupes_by_host() {
        let mut list = vec![];
        super::upsert_machine(&mut list, "a", Some("A".into()));
        super::upsert_machine(&mut list, "a", Some("A2".into())); // same host
        super::upsert_machine(&mut list, "b", None);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].label.as_deref(), Some("A2")); // label updated in place
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test --lib compute::tests 2>&1 | tail -20`
Expected: FAIL — `parse_machines` etc. not found.

- [ ] **Step 3: Implement the model + helpers**

Add to `compute.rs`:
```rust
/// Static capability snapshot cached in compute.json — the ONLY thing the agent
/// reads to pick a machine. Never holds time-varying usage.
#[derive(Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct Caps {
    pub cores: Option<u32>,
    pub mem_total_bytes: Option<u64>,
    #[serde(default)]
    pub gpus: Vec<String>,
    pub slurm: Option<String>,
}

/// A saved remote machine. `caps` is absent until the first successful probe.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Machine {
    pub host: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub caps: Option<Caps>,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct MachinesFile {
    #[serde(default)]
    machines: Vec<Machine>,
}

/// Parse compute.json; malformed content yields an empty list rather than an
/// error (a hand-broken file must not brick the settings page).
fn parse_machines(json: &str) -> Vec<Machine> {
    serde_json::from_str::<MachinesFile>(json).map(|f| f.machines).unwrap_or_default()
}

/// Import a legacy `{"host":"…"}` hpc.json as a single machine (no caps yet).
fn legacy_to_machines(hpc_json: &str) -> Vec<Machine> {
    serde_json::from_str::<serde_json::Value>(hpc_json)
        .ok()
        .and_then(|v| v.get("host").and_then(|h| h.as_str()).map(str::to_string))
        .map(|host| vec![Machine { host, label: None, caps: None }])
        .unwrap_or_default()
}

/// Insert or update a machine by host (dedupe). Updates the label in place;
/// preserves any existing caps.
fn upsert_machine(list: &mut Vec<Machine>, host: &str, label: Option<String>) {
    if let Some(m) = list.iter_mut().find(|m| m.host == host) {
        if label.is_some() {
            m.label = label;
        }
    } else {
        list.push(Machine { host: host.to_string(), label, caps: None });
    }
}

/// The static slice of a probe worth caching for agent machine-selection.
fn caps_from_probe(p: &ComputeProbe) -> Caps {
    Caps {
        cores: p.cores,
        mem_total_bytes: p.mem_total_bytes,
        gpus: p.gpus.iter().map(|g| g.name.clone()).collect(),
        slurm: p.slurm.clone(),
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test --lib compute::tests 2>&1 | tail -20`
Expected: PASS (all model tests + earlier probe/host tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(compute): machine model, compute.json parsing + legacy migration"
```

---

### Task 4: Tauri commands (probe + machine CRUD + jobs), registered

Adds the new `compute_*` commands ALONGSIDE the existing `hpc_*` ones (removed later in Task 8), so the current UI keeps working.

**Files:**
- Modify: `apps/desktop/src-tauri/src/compute.rs` (commands + `PROBE_SCRIPT` + file IO)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register 6 commands)

**Interfaces:**
- Consumes: `run_ssh`, `is_safe_host`, `is_safe_job_id`, `parse_squeue`, `HpcJob`, `ComputeProbe`, `parse_probe`, `Machine`, `parse_machines`, `legacy_to_machines`, `upsert_machine`, `caps_from_probe`, and `crate::runtime::workspace_dir` (all in scope in this module).
- Produces Tauri commands: `compute_machines() -> Vec<Machine>`, `add_compute_machine(host: String, label: Option<String>)`, `remove_compute_machine(host: String)`, `compute_probe(host: String) -> ComputeProbe`, `compute_jobs(host: String) -> Vec<HpcJob>`, `compute_cancel(host: String, job_id: String)`.

- [ ] **Step 1: Add the config path, probe script, and IO helpers**

Add to `compute.rs`:
```rust
/// New machine-list config; supersedes the single-host hpc.json.
const COMPUTE_FILE: &str = "compute.json";

fn compute_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(workspace_dir(app)?.join(".openscience").join(COMPUTE_FILE))
}

/// One SSH round-trip: static identity + a live usage snapshot, one token per
/// line, tolerant of missing tools (Linux remote assumed).
const PROBE_SCRIPT: &str = r#"echo "OS $(uname -sr)"
echo "CORES $(nproc 2>/dev/null)"
cut -d' ' -f1 /proc/loadavg 2>/dev/null | sed 's/^/LOAD /'
free -b 2>/dev/null | awk '/^Mem:/{print "MEMTOTAL",$2; print "MEMAVAIL",$7}'
df -PB1 "$HOME" 2>/dev/null | awk 'NR==2{print "DISKTOTAL",$2; print "DISKFREE",$4}'
command -v sbatch >/dev/null 2>&1 && echo "SLURM $(sbatch --version 2>/dev/null | head -1)"
command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits | sed 's/^/GPU /'
"#;

fn load_machines(app: &AppHandle) -> Result<Vec<Machine>, String> {
    let path = compute_path(app)?;
    if let Ok(text) = std::fs::read_to_string(&path) {
        return Ok(parse_machines(&text));
    }
    // Migrate a legacy hpc.json exactly once, then remove it.
    let legacy = workspace_dir(app)?.join(".openscience").join("hpc.json");
    if let Ok(text) = std::fs::read_to_string(&legacy) {
        let machines = legacy_to_machines(&text);
        save_machines(app, &machines)?;
        let _ = std::fs::remove_file(&legacy);
        return Ok(machines);
    }
    Ok(Vec::new())
}

fn save_machines(app: &AppHandle, machines: &[Machine]) -> Result<(), String> {
    let path = compute_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string(&MachinesFile { machines: machines.to_vec() })
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add the commands**

Add to `compute.rs`:
```rust
#[tauri::command]
pub fn compute_machines(app: AppHandle) -> Result<Vec<Machine>, String> {
    load_machines(&app)
}

#[tauri::command]
pub fn add_compute_machine(app: AppHandle, host: String, label: Option<String>) -> Result<(), String> {
    if !is_safe_host(&host) {
        return Err("invalid host".into());
    }
    let mut machines = load_machines(&app)?;
    upsert_machine(&mut machines, &host, label);
    save_machines(&app, &machines)
}

#[tauri::command]
pub fn remove_compute_machine(app: AppHandle, host: String) -> Result<(), String> {
    let mut machines = load_machines(&app)?;
    machines.retain(|m| m.host != host);
    save_machines(&app, &machines)
}

/// Probe a host and, when reachable, write its static caps back into
/// compute.json (only if the host is already saved — probing during add is fine
/// because add runs first). Live usage in the return value is never cached.
#[tauri::command]
pub async fn compute_probe(app: AppHandle, host: String) -> Result<ComputeProbe, String> {
    let (code, stdout, stderr) = run_ssh(&app, &host, PROBE_SCRIPT).await?;
    if code == 255 {
        let mut detail = stderr.lines().last().unwrap_or("connection failed").trim().to_string();
        if stderr.contains("Host key verification failed") {
            detail = format!(
                "host key not verified — run `ssh {host}` once in your terminal to check \
                 and accept its fingerprint, then retry"
            );
        }
        return Ok(ComputeProbe { reachable: false, message: Some(detail), ..Default::default() });
    }
    let mut probe = parse_probe(&stdout);
    probe.reachable = true;
    // Cache the static caps for agent selection (best-effort).
    if let Ok(mut machines) = load_machines(&app) {
        if let Some(m) = machines.iter_mut().find(|m| m.host == host) {
            m.caps = Some(caps_from_probe(&probe));
            let _ = save_machines(&app, &machines);
        }
    }
    Ok(probe)
}

/// A Slurm host's queue (only meaningful when the machine has Slurm).
#[tauri::command]
pub async fn compute_jobs(app: AppHandle, host: String) -> Result<Vec<HpcJob>, String> {
    let (code, stdout, stderr) =
        run_ssh(&app, &host, "squeue -u \"$USER\" -h -o '%i|%T|%M|%P|%j'").await?;
    if code != 0 {
        return Err(stderr.lines().last().unwrap_or("squeue failed").trim().to_string());
    }
    Ok(parse_squeue(&stdout))
}

#[tauri::command]
pub async fn compute_cancel(app: AppHandle, host: String, job_id: String) -> Result<(), String> {
    if !is_safe_job_id(&job_id) {
        return Err("invalid job id".into());
    }
    let (code, _, stderr) = run_ssh(&app, &host, &format!("scancel '{job_id}'")).await?;
    if code != 0 {
        return Err(stderr.lines().last().unwrap_or("scancel failed").trim().to_string());
    }
    Ok(())
}
```

- [ ] **Step 3: Register the commands**

In `apps/desktop/src-tauri/src/lib.rs`, add these to the `tauri::generate_handler!` list right after the existing `compute::hpc_cancel,` line:
```rust
            compute::compute_machines,
            compute::add_compute_machine,
            compute::remove_compute_machine,
            compute::compute_probe,
            compute::compute_jobs,
            compute::compute_cancel,
```

- [ ] **Step 4: Build + test**

Run:
```bash
cd apps/desktop/src-tauri && cargo test --lib compute 2>&1 | tail -20 && cargo build 2>&1 | tail -5
```
Expected: builds clean; all `compute` tests PASS. (Warnings about unused `hpc_*` are fine — they're still registered.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(compute): probe/machine-CRUD/jobs Tauri commands + compute.json IO"
```

---

### Task 5: Frontend bindings (`tauri.ts`)

Adds the new bindings/types alongside the existing hpc ones (removed in Task 8).

**Files:**
- Modify: `apps/desktop/src/lib/tauri.ts`

**Interfaces:**
- Produces (exported): `GpuInfo`, `ComputeProbe`, `MachineCaps`, `Machine`, `ComputeJob` types; `computeMachines()`, `addComputeMachine(host, label?)`, `removeComputeMachine(host)`, `computeProbe(host)`, `computeJobs(host)`, `computeCancel(host, jobId)`.

- [ ] **Step 1: Add the types and bindings**

Append to `apps/desktop/src/lib/tauri.ts` (before the final `configureOpenCode`, or at end of the HPC section):
```ts
export interface GpuInfo {
  name: string;
  mem_total_mib: number;
  mem_used_mib: number;
  util_pct: number;
}

/** One live SSH probe of a remote machine (capabilities + usage snapshot). */
export interface ComputeProbe {
  reachable: boolean;
  message: string | null;
  os: string | null;
  cores: number | null;
  load1: number | null;
  mem_total_bytes: number | null;
  mem_avail_bytes: number | null;
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
  gpus: GpuInfo[];
  slurm: string | null;
}

/** Static capability cache the agent reads to pick a machine. */
export interface MachineCaps {
  cores: number | null;
  mem_total_bytes: number | null;
  gpus: string[];
  slurm: string | null;
}

export interface Machine {
  host: string;
  label: string | null;
  caps: MachineCaps | null;
}

/** A Slurm queue entry (same shape as the old HpcJob). */
export interface ComputeJob {
  id: string;
  state: string;
  time: string;
  partition: string;
  name: string;
}

/** Saved remote machines (migrates a legacy hpc.json on first read). */
export async function computeMachines(): Promise<Machine[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Machine[]>("compute_machines");
}

/** Save (or update the label of) a remote machine. */
export async function addComputeMachine(host: string, label?: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("add_compute_machine", { host, label: label ?? null });
}

export async function removeComputeMachine(host: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_compute_machine", { host });
}

/** Probe a machine over SSH; also caches its static caps for the agent. */
export async function computeProbe(host: string): Promise<ComputeProbe> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ComputeProbe>("compute_probe", { host });
}

/** A Slurm host's queue. */
export async function computeJobs(host: string): Promise<ComputeJob[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ComputeJob[]>("compute_jobs", { host });
}

export async function computeCancel(host: string, jobId: string): Promise<void> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("compute_cancel", { host, jobId });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/desktop && npx tsc --noEmit -p tsconfig.json 2>&1 | head`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(compute): frontend bindings for remote-compute commands"
```

---

### Task 6: `RemoteComputeCard` component + wire into Settings (TDD)

**Files:**
- Create: `apps/desktop/src/components/settings/RemoteComputeCard.tsx`
- Create: `apps/desktop/src/components/settings/RemoteComputeCard.test.tsx`
- Modify: `apps/desktop/src/app/routes/SettingsPage.tsx` (swap `ClusterCard` → `RemoteComputeCard`)
- Delete: `apps/desktop/src/components/settings/ClusterCard.tsx`, `apps/desktop/src/components/settings/ClusterCard.test.tsx`

**Interfaces:**
- Consumes: `computeMachines`, `addComputeMachine`, `removeComputeMachine`, `computeProbe`, `computeJobs`, `computeCancel`, `listSshHosts`, `Machine`, `ComputeProbe`, `ComputeJob` from `@/lib/tauri`.
- Produces: `export function RemoteComputeCard()`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/components/settings/RemoteComputeCard.test.tsx`:
```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputeProbe, ComputeJob, Machine } from "@/lib/tauri";
import { RemoteComputeCard } from "./RemoteComputeCard";

const bridge = {
  listSshHosts: vi.fn<() => Promise<string[]>>(),
  computeMachines: vi.fn<() => Promise<Machine[]>>(),
  addComputeMachine: vi.fn<(h: string, l?: string) => Promise<void>>(),
  removeComputeMachine: vi.fn<(h: string) => Promise<void>>(),
  computeProbe: vi.fn<(h: string) => Promise<ComputeProbe>>(),
  computeJobs: vi.fn<(h: string) => Promise<ComputeJob[]>>(),
  computeCancel: vi.fn<(h: string, id: string) => Promise<void>>(),
};

vi.mock("@/lib/tauri", () => ({
  isTauri: true,
  listSshHosts: (...a: []) => bridge.listSshHosts(...a),
  computeMachines: (...a: []) => bridge.computeMachines(...a),
  addComputeMachine: (...a: [string, string?]) => bridge.addComputeMachine(...a),
  removeComputeMachine: (...a: [string]) => bridge.removeComputeMachine(...a),
  computeProbe: (...a: [string]) => bridge.computeProbe(...a),
  computeJobs: (...a: [string]) => bridge.computeJobs(...a),
  computeCancel: (...a: [string, string]) => bridge.computeCancel(...a),
}));

const gpuProbe: ComputeProbe = {
  reachable: true, message: null, os: "Linux 6.5", cores: 16, load1: 1.2,
  mem_total_bytes: 67_516_000_000, mem_avail_bytes: 55_000_000_000,
  disk_total_bytes: 2_000_000_000_000, disk_free_bytes: 1_200_000_000_000,
  gpus: [
    { name: "RTX 3090", mem_total_mib: 24576, mem_used_mib: 8100, util_pct: 40 },
    { name: "RTX 3090", mem_total_mib: 24576, mem_used_mib: 0, util_pct: 0 },
  ],
  slurm: null,
};
const slurmProbe: ComputeProbe = { ...gpuProbe, gpus: [], slurm: "slurm 23.11.4" };

describe("RemoteComputeCard", () => {
  beforeEach(() => {
    Object.values(bridge).forEach((f) => f.mockReset());
    bridge.listSshHosts.mockResolvedValue(["home-3090"]);
  });

  it("lists a non-Slurm machine with capability chips and never reads the queue", async () => {
    bridge.computeMachines.mockResolvedValue([{ host: "home-3090", label: "8x3090", caps: null }]);
    bridge.computeProbe.mockResolvedValue(gpuProbe);
    render(<RemoteComputeCard />);

    expect(await screen.findByText("home-3090")).toBeInTheDocument();
    expect(await screen.findByText(/16 cores/)).toBeInTheDocument();
    expect(screen.getByText(/2× RTX 3090/)).toBeInTheDocument();
    expect(bridge.computeJobs).not.toHaveBeenCalled();
  });

  it("adds a machine then probes it", async () => {
    bridge.computeMachines.mockResolvedValue([]);
    bridge.addComputeMachine.mockResolvedValue();
    bridge.computeProbe.mockResolvedValue(gpuProbe);
    bridge.computeMachines.mockResolvedValueOnce([]); // initial load: none
    render(<RemoteComputeCard />);

    await userEvent.type(screen.getByRole("combobox"), "home-3090");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(bridge.addComputeMachine).toHaveBeenCalledWith("home-3090", undefined));
    await waitFor(() => expect(bridge.computeProbe).toHaveBeenCalledWith("home-3090"));
  });

  it("shows the Slurm queue for a Slurm machine", async () => {
    bridge.computeMachines.mockResolvedValue([{ host: "login-a", label: null, caps: null }]);
    bridge.computeProbe.mockResolvedValue(slurmProbe);
    bridge.computeJobs.mockResolvedValue([
      { id: "42", state: "RUNNING", time: "1:23", partition: "gpu", name: "fit-model" },
    ]);
    render(<RemoteComputeCard />);

    expect(await screen.findByText(/Slurm/)).toBeInTheDocument();
    await waitFor(() => expect(bridge.computeJobs).toHaveBeenCalledWith("login-a"));
    expect(await screen.findByText("fit-model")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/desktop && npx vitest run src/components/settings/RemoteComputeCard.test.tsx 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./RemoteComputeCard`.

- [ ] **Step 3: Implement the component**

Create `apps/desktop/src/components/settings/RemoteComputeCard.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import {
  addComputeMachine,
  computeCancel,
  computeJobs,
  computeMachines,
  computeProbe,
  isTauri,
  listSshHosts,
  removeComputeMachine,
  type ComputeJob,
  type ComputeProbe,
  type GpuInfo,
  type Machine,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

/**
 * Remote compute over SSH. Connect any machine you can SSH to (CPU or GPU;
 * Slurm optional). Each machine shows capability chips and an expandable
 * detail: a usage snapshot (non-Slurm) or the Slurm queue (Slurm). The chosen
 * host is recorded in .openscience/compute.json for the remote-compute skill.
 */
export function RemoteComputeCard() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Per-host live probe + expand/queue state, keyed by host.
  const [probes, setProbes] = useState<Record<string, ComputeProbe | "loading">>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<Record<string, ComputeJob[] | null>>({});

  const probe = useCallback(async (host: string) => {
    setProbes((p) => ({ ...p, [host]: "loading" }));
    try {
      const result = await computeProbe(host);
      setProbes((p) => ({ ...p, [host]: result }));
      // Read the queue only for Slurm hosts — no queue exists otherwise.
      if (result.slurm) {
        try {
          setJobs((j) => ({ ...j, [host]: await computeJobs(host) }));
        } catch {
          setJobs((j) => ({ ...j, [host]: null }));
        }
      }
    } catch (e) {
      setProbes((p) => ({
        ...p,
        [host]: { reachable: false, message: e instanceof Error ? e.message : String(e) } as ComputeProbe,
      }));
    }
  }, []);

  const loadMachines = useCallback(async () => {
    const list = await computeMachines().catch(() => []);
    setMachines(list);
    list.forEach((m) => void probe(m.host));
  }, [probe]);

  useEffect(() => {
    if (!isTauri) return;
    void listSshHosts().then(setHosts).catch(() => undefined);
    void loadMachines();
  }, [loadMachines]);

  const add = async () => {
    const host = draft.trim();
    if (!host) return;
    setAdding(true);
    setAddError(null);
    try {
      await addComputeMachine(host);
      setDraft("");
      await loadMachines();
      void probe(host);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (host: string) => {
    try {
      await removeComputeMachine(host);
      setMachines((m) => m.filter((x) => x.host !== host));
    } catch (e) {
      toast.error(`Could not remove: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const cancel = async (host: string, id: string) => {
    try {
      await computeCancel(host, id);
      toast.success(`Job ${id} canceled`);
      setJobs((j) => ({ ...j, [host]: await computeJobs(host) }));
    } catch (e) {
      toast.error(`Could not cancel ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section className="mt-5 rounded-card border border-border bg-surface shadow-card">
      <header className="border-b border-border px-5 py-3">
        <h2 className="font-serif text-[15px] text-text">Remote compute</h2>
        <p className="mt-0.5 text-xs text-muted">
          Run jobs on your own servers over SSH — CPU or GPU; Slurm optional. Uses your own SSH
          keys; nothing is installed on the machine.
        </p>
      </header>
      <div className="px-5 py-4">
        {!isTauri ? (
          <p className="text-[13px] text-muted">Available in the desktop app.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-input border border-border">
              {machines.length === 0 && (
                <p className="bg-surface px-3 py-2.5 text-[13px] text-muted">
                  No machines yet — add one below.
                </p>
              )}
              {machines.map((m, i) => (
                <MachineRow
                  key={m.host}
                  machine={m}
                  probe={probes[m.host]}
                  expanded={!!expanded[m.host]}
                  jobs={jobs[m.host]}
                  first={i === 0}
                  onToggle={() => setExpanded((e) => ({ ...e, [m.host]: !e[m.host] }))}
                  onRefresh={() => void probe(m.host)}
                  onRemove={() => void remove(m.host)}
                  onCancel={(id) => void cancel(m.host, id)}
                />
              ))}
              <div className={cn("bg-surface-2/50 p-3", machines.length > 0 && "border-t border-border")}>
                <div className="flex items-center gap-2">
                  <input
                    list="ssh-hosts"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void add()}
                    placeholder={
                      hosts.length > 0
                        ? `user@host — or pick from your ~/.ssh/config (${hosts.length})`
                        : "user@host.example.edu"
                    }
                    className={inputCls("flex-1 font-mono")}
                  />
                  <datalist id="ssh-hosts">
                    {hosts.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                  <button className={btnAccent()} onClick={() => void add()} disabled={adding || !draft.trim()}>
                    {adding ? <Loader2 size={12} className="animate-spin" /> : null}
                    {adding ? "Adding…" : "Add"}
                  </button>
                </div>
                {addError && <p className="mt-2 text-xs text-error">{addError}</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function MachineRow({
  machine,
  probe,
  expanded,
  jobs,
  first,
  onToggle,
  onRefresh,
  onRemove,
  onCancel,
}: {
  machine: Machine;
  probe: ComputeProbe | "loading" | undefined;
  expanded: boolean;
  jobs: ComputeJob[] | null | undefined;
  first: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onCancel: (id: string) => void;
}) {
  const loading = probe === "loading" || probe === undefined;
  const p = typeof probe === "object" ? probe : null;
  const reachable = !!p?.reachable;
  const chips = p && reachable ? capabilityChips(p) : [];
  return (
    <div className={cn("bg-surface", !first && "border-t border-border")}>
      <div className="flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
        <button
          className="shrink-0 text-muted transition-colors hover:text-text"
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight size={13} className={cn("transition-transform", expanded && "rotate-90")} />
        </button>
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            loading ? "bg-muted" : reachable ? "bg-ok" : "bg-error",
          )}
        />
        <span className="font-mono font-medium text-text">{machine.label || machine.host}</span>
        {machine.label && <span className="text-xs text-muted">{machine.host}</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {loading ? "checking…" : reachable ? chips.join(" · ") : p?.message ?? "unreachable"}
        </span>
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-muted transition-colors hover:bg-surface-2 hover:text-text"
          onClick={onRefresh}
          title="Re-probe this machine"
          aria-label="Re-probe this machine"
        >
          <RefreshCw size={13} className={cn(loading && "animate-spin")} />
        </button>
        <button
          className="shrink-0 text-xs text-muted transition-colors hover:text-error"
          onClick={onRemove}
          title="Remove this machine"
        >
          Remove
        </button>
      </div>
      {expanded && reachable && p && (
        <div className="border-t border-border bg-surface-2/40 px-3 py-2.5">
          {p.slurm ? (
            <SlurmQueue jobs={jobs} onCancel={onCancel} />
          ) : (
            <UsageSnapshot p={p} />
          )}
        </div>
      )}
    </div>
  );
}

function UsageSnapshot({ p }: { p: ComputeProbe }) {
  return (
    <div className="space-y-1.5 text-xs text-muted">
      {p.cores != null && p.load1 != null && (
        <div>
          <span className="text-text">CPU load</span> {p.load1.toFixed(2)} / {p.cores} cores
        </div>
      )}
      {p.mem_total_bytes != null && (
        <div>
          <span className="text-text">Memory</span>{" "}
          {fmtBytes((p.mem_total_bytes ?? 0) - (p.mem_avail_bytes ?? 0))} / {fmtBytes(p.mem_total_bytes)}
        </div>
      )}
      {p.gpus.map((g, i) => (
        <div key={i}>
          <span className="text-text">{g.name}</span> {g.util_pct}% ·{" "}
          {Math.round(g.mem_used_mib / 1024)} / {Math.round(g.mem_total_mib / 1024)} GB
        </div>
      ))}
      {p.disk_free_bytes != null && p.disk_total_bytes != null && (
        <div>
          <span className="text-text">Disk</span> {fmtBytes(p.disk_free_bytes)} free /{" "}
          {fmtBytes(p.disk_total_bytes)}
        </div>
      )}
    </div>
  );
}

function SlurmQueue({
  jobs,
  onCancel,
}: {
  jobs: ComputeJob[] | null | undefined;
  onCancel: (id: string) => void;
}) {
  if (jobs === undefined) return <p className="text-xs text-muted">Reading the queue…</p>;
  if (jobs === null) return <p className="text-xs text-muted">Queue unavailable.</p>;
  if (jobs.length === 0) return <p className="text-xs text-muted">No jobs in the queue.</p>;
  return (
    <div className="space-y-1">
      {jobs.map((j) => (
        <div key={j.id} className="flex items-center gap-2.5 text-[13px]">
          <span className="font-mono text-xs text-muted">{j.id}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-border",
              j.state === "RUNNING" ? "text-ok" : j.state === "PENDING" ? "text-warn" : "text-muted",
            )}
          >
            {j.state}
          </span>
          <span className="min-w-0 flex-1 truncate text-text">{j.name}</span>
          <span className="font-mono text-xs text-muted">{j.time}</span>
          <span className="text-xs text-muted">{j.partition}</span>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-input text-muted transition-colors hover:bg-surface-2 hover:text-error"
            onClick={() => onCancel(j.id)}
            title={`Cancel job ${j.id}`}
            aria-label={`Cancel job ${j.id}`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Collapsed identity chips, e.g. ["16 cores", "64 GB", "2× RTX 3090", "1.2 TB free"]. */
function capabilityChips(p: ComputeProbe): string[] {
  const chips: string[] = [];
  if (p.cores != null) chips.push(`${p.cores} cores`);
  if (p.mem_total_bytes != null) chips.push(fmtBytes(p.mem_total_bytes));
  const gpu = gpuSummary(p.gpus);
  if (gpu) chips.push(gpu);
  if (p.disk_free_bytes != null) chips.push(`${fmtBytes(p.disk_free_bytes)} free`);
  if (p.slurm) chips.push(p.slurm.replace(/^slurm\s*/i, "Slurm "));
  return chips;
}

function gpuSummary(gpus: GpuInfo[]): string | null {
  if (gpus.length === 0) return null;
  const name = gpus[0].name;
  return gpus.every((g) => g.name === name) ? `${gpus.length}× ${name}` : `${gpus.length} GPUs`;
}

/** Bytes → short human string: 64 GB, 1.2 TB, 400 GB. */
function fmtBytes(n: number | null): string {
  if (n == null) return "?";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

const inputCls = (extra = "") =>
  cn(
    "h-9 rounded-input border border-border bg-surface px-3 text-[13px] text-text outline-none",
    "placeholder:text-muted focus:border-accent/60",
    extra,
  );

// Color-based hover/disabled, never `opacity` (which flickers in WKWebView).
const btnAccent = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3.5 text-[13px] font-medium",
    "text-accent-fg transition-colors hover:bg-accent/90 disabled:bg-accent/50",
    extra,
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/components/settings/RemoteComputeCard.test.tsx 2>&1 | tail -15`
Expected: PASS (3 tests).

- [ ] **Step 5: Swap into SettingsPage and delete ClusterCard**

In `apps/desktop/src/app/routes/SettingsPage.tsx`, change the import:
```tsx
import { RemoteComputeCard } from "@/components/settings/RemoteComputeCard";
```
(remove the `ClusterCard` import) and replace the `<ClusterCard />` usage with:
```tsx
        <RemoteComputeCard />
```
Then delete the old files:
```bash
cd apps/desktop && rm src/components/settings/ClusterCard.tsx src/components/settings/ClusterCard.test.tsx
```

- [ ] **Step 6: Typecheck, lint, full frontend tests**

Run:
```bash
cd apps/desktop && npx tsc --noEmit -p tsconfig.json 2>&1 | head && \
  npx eslint src/components/settings/RemoteComputeCard.tsx src/app/routes/SettingsPage.tsx 2>&1 | head && \
  npx vitest run 2>&1 | tail -6
```
Expected: tsc clean; eslint clean; all frontend test files pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(compute): RemoteComputeCard (multi-machine, capabilities, snapshot/queue) replacing ClusterCard"
```

---

### Task 7: Remove the superseded `hpc_*` commands and bindings

Now that the UI uses `compute_*`, delete the dead Slurm-only path.

**Files:**
- Modify: `apps/desktop/src-tauri/src/compute.rs` (remove `hpc_check`, `hpc_config`, `set_hpc_config`, `hpc_jobs`, `hpc_cancel` and now-unused helpers like `HpcCheck`, `config_path`/`CONFIG_FILE`, `load_meta`-style hpc-only bits — keep `run_ssh`, `is_safe_host`, `is_safe_job_id`, `parse_squeue`, `HpcJob`, `list_ssh_hosts` which the new commands use)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (drop the five `compute::hpc_*` registrations; keep `compute::list_ssh_hosts`)
- Modify: `apps/desktop/src/lib/tauri.ts` (remove `hpcConfig`, `setHpcConfig`, `hpcCheck`, `hpcJobs`, `hpcCancel`, and `HpcCheck`/`HpcJob` types; keep `listSshHosts`)

**Interfaces:**
- Produces: no new interface; net removal. `compute::list_ssh_hosts` and the shared SSH helpers remain.

- [ ] **Step 1: Remove the Rust hpc commands**

In `compute.rs`, delete the functions `hpc_check`, `hpc_config`, `set_hpc_config`, `hpc_jobs`, `hpc_cancel`, the `HpcCheck` struct, and the now-unused `CONFIG_FILE`/`config_path` (the old single-host `hpc.json` helpers). Keep `run_ssh`, `is_safe_host`, `is_safe_job_id`, `is_host_char`, `parse_ssh_hosts`, `parse_squeue`, `HpcJob`, `list_ssh_hosts`, and all the compute/probe/machine code. Run a compile to see exactly what's now unused:
```bash
cd apps/desktop/src-tauri && cargo build 2>&1 | grep -A2 "never used" | head -40
```
Delete anything the compiler flags as unused that belonged to the old path (e.g. leftover `HpcCheck`).

- [ ] **Step 2: Remove the registrations**

In `apps/desktop/src-tauri/src/lib.rs`, delete these five lines:
```rust
            compute::hpc_config,
            compute::set_hpc_config,
            compute::hpc_check,
            compute::hpc_jobs,
            compute::hpc_cancel,
```
Keep `compute::list_ssh_hosts,` and the six `compute::compute_*` lines.

- [ ] **Step 3: Remove the frontend hpc bindings**

In `apps/desktop/src/lib/tauri.ts`, delete the exports `hpcConfig`, `setHpcConfig`, `hpcCheck`, `hpcJobs`, `hpcCancel` and the `HpcCheck` and `HpcJob` interfaces. Keep `listSshHosts`. Verify nothing else imports them:
```bash
cd apps/desktop && grep -rn "hpcConfig\|setHpcConfig\|hpcCheck\|hpcJobs\|hpcCancel\|HpcCheck\b\|HpcJob\b" src | grep -v "compute.rs"
```
Expected: no matches (the new card uses `ComputeJob`, not `HpcJob`).

- [ ] **Step 4: Build + typecheck + full tests**

Run:
```bash
cd apps/desktop/src-tauri && cargo test --lib compute 2>&1 | tail -15 && cargo build 2>&1 | tail -5
cd apps/desktop && npx tsc --noEmit -p tsconfig.json 2>&1 | head && npx vitest run 2>&1 | tail -6
```
Expected: Rust builds with no "never used" warnings for the removed path; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(compute): remove superseded Slurm-only hpc_* commands + bindings"
```

---

### Task 8: Agent skill — rename `hpc-slurm` → `remote-compute`, add direct-SSH flow

**Files:**
- Rename: `runtime/skills/core/hpc-slurm/` → `runtime/skills/core/remote-compute/`
- Modify: `runtime/skills/core/remote-compute/SKILL.md` (rewrite: unified, machine selection, direct-SSH flow, updated helper path)
- Modify: `runtime/skills/core/remote-compute/record_run.py` (add `"ssh"` to `--surface` choices)

**Interfaces:**
- Consumes: `.openscience/compute.json` (§2 schema) written by the app.
- Produces: skill `remote-compute`; `record_run.py --surface {hpc,modal,ssh}`.

- [ ] **Step 1: Rename the skill directory**

Run:
```bash
cd /Users/asq/data/workspace/desktop_project/open-ai4s-workbench
git mv runtime/skills/core/hpc-slurm runtime/skills/core/remote-compute
```

- [ ] **Step 2: Add the `ssh` surface to record_run.py**

In `runtime/skills/core/remote-compute/record_run.py`, change the `--surface` choices line:
```python
    p.add_argument("--surface", required=True, choices=["hpc", "modal", "ssh"], help="compute surface")
```
And update the module docstring's first line reference from "hpc-slurm / modal-run skills" to "remote-compute / modal-run skills".

- [ ] **Step 3: Verify record_run.py still runs**

Run:
```bash
cd /tmp && rm -rf rr && mkdir -p rr && cd rr && \
python "/Users/asq/data/workspace/desktop_project/open-ai4s-workbench/runtime/skills/core/remote-compute/record_run.py" \
  --surface ssh --command "bash run.sh" --status ok --host home-3090 \
  --hardware "8× RTX 3090" && cat .openscience/remote-runs.jsonl
```
Expected: prints "Recorded ssh run …" and the JSONL line has `"surface": "ssh"`.

- [ ] **Step 4: Rewrite SKILL.md**

Replace the entire contents of `runtime/skills/core/remote-compute/SKILL.md` with:
````markdown
---
name: remote-compute
description: Use when the user asks to run, submit, monitor, or cancel a job on a remote machine over SSH — their own GPU/CPU server, a workstation, or a Slurm cluster ("the cluster", a login node, "my 3090 box", "the compute server"). Picks a saved machine, runs the work directly over SSH (or via Slurm when present), tracks it, and fetches results back into the workspace.
---

# Remote compute over SSH

Run heavy work on the user's own machines over non-interactive SSH with their
own keys — you never install anything remote and never handle credentials.
A machine may be a plain server (CPU or GPU, no scheduler) or a Slurm cluster.

## 1 · Pick the machine

1. `cat .openscience/compute.json` in the workspace. It looks like:
   `{"machines":[{"host":"home-3090","label":"8x3090",
     "caps":{"cores":16,"mem_total_bytes":...,"gpus":["RTX 3090",...],"slurm":null}}]}`
   The directory is hidden — read the file directly.
2. If the file is missing or has no machines, ask the user to add one in
   **Settings → Remote compute**, or give you a `user@host`. Do not guess.
3. Choose by the task's needs and each machine's `caps`: a GPU job → a machine
   whose `caps.gpus` is non-empty; a CPU job → any reachable machine. If several
   fit, or none clearly does, ask the user which to use.
4. Confirm it's reachable and check live headroom before launching:
   `ssh -o BatchMode=yes -o ConnectTimeout=8 <host> "nproc; free -h; nvidia-smi 2>/dev/null | head -15"`.
   On "Permission denied", tell the user their key doesn't reach the host — do
   not retry with passwords.

If the chosen machine's `caps.slurm` is set, use **§2-Slurm**. Otherwise use
**§2-Direct**.

## 2-Direct · Run on a plain server (no Slurm)

Long jobs must outlive the SSH connection. Use a per-job dir + a fully detached
process, mirroring how the app tracks runs.

1. Pick a job name and build the remote dir path (remember the literal string —
   shell variables do not survive between separate ssh calls):
   `REMOTE=openscience/jobs/<name>-<YYYYmmdd-HHMMSS>`
2. Create it and copy inputs (confirm with the user before copying > ~100 MB):
   ```bash
   ssh -o BatchMode=yes <host> "mkdir -p <remote-dir>"
   scp -o BatchMode=yes run.sh <input files> <host>:<remote-dir>/
   ```
   Write `run.sh` in the workspace first (so it is versioned in provenance);
   it should `cd` into the job dir and run the actual commands, e.g. use
   `CUDA_VISIBLE_DEVICES` to select GPUs.
3. Launch fully detached and capture the PID:
   ```bash
   ssh -o BatchMode=yes <host> "cd <remote-dir> && \
     setsid bash -c 'bash run.sh >log 2>&1; echo \$? > exit_code' </dev/null >/dev/null 2>&1 & \
     echo \$! > pid; cat pid"
   ```
   Report the PID and the remote dir to the user.
4. **Track:**
   - Running? `ssh <host> "kill -0 \$(cat <remote-dir>/pid) 2>/dev/null && echo RUNNING || echo DONE"`.
   - Progress: `ssh <host> "tail -n 30 <remote-dir>/log"`; GPU use:
     `ssh <host> "nvidia-smi"`.
   - Finished: `ssh <host> "cat <remote-dir>/exit_code"` — `0` = success, other
     = failure. Do not assume success from an empty queue.
   - Long jobs: report the PID + running state and stop; the user can ask you to
     check again later. Do not poll in a loop for more than ~2 minutes.
5. **Cancel** (only jobs you launched, or a PID/dir the user names): kill the
   whole process group so children die too:
   `ssh <host> "kill -- -\$(cat <remote-dir>/pid) 2>/dev/null || kill \$(cat <remote-dir>/pid)"`.

## 2-Slurm · Run on a Slurm cluster

Use this only when `caps.slurm` is set.

1. Write `slurm/<job-name>.sbatch` in the workspace:
   ```bash
   #!/bin/bash
   #SBATCH --job-name=<job-name>
   #SBATCH --output=slurm-%j.out
   #SBATCH --error=slurm-%j.err
   #SBATCH --time=01:00:00

   set -euo pipefail
   cd "$SLURM_SUBMIT_DIR"
   <the actual commands>
   ```
   Only add `--partition/--gres/--mem/--cpus-per-task` when the user asks or the
   cluster rejects the default. Load modules (`module load …`) the user names.
2. Submit:
   ```bash
   REMOTE=openscience/jobs/<job-name>-$(date +%Y%m%d-%H%M%S)
   ssh -o BatchMode=yes <host> "mkdir -p $REMOTE"
   scp -o BatchMode=yes slurm/<job-name>.sbatch <input files> <host>:$REMOTE/
   ssh -o BatchMode=yes <host> "cd $REMOTE && sbatch <job-name>.sbatch"
   ```
   Parse `Submitted batch job <id>`; remember the literal remote dir.
3. Track: `ssh <host> "squeue -j <id> -h -o '%T %M'"`; when it returns nothing,
   `ssh <host> "sacct -j <id> --format=State,Elapsed,ExitCode -n"` or read
   `slurm-<id>.out`. Cancel: `ssh <host> "scancel <id>"`.

## 3 · Fetch results back

Copy outputs into the workspace so they become traceable artifacts:
```bash
mkdir -p results/<job-name>
scp -o BatchMode=yes "<host>:<remote-dir>/log" \
    "<host>:<remote-dir>/<result file>" results/<job-name>/
```
`<remote-dir>` is the literal directory you created — name each file explicitly.

## 4 · Record the run (reproducibility)

The app can't see the remote machine, so record the run after results are
fetched. Get the hardware string from your §1 headroom check (e.g. "8× RTX 3090"
or "16 cores, 64 GB"). Then, from the workspace root:

```bash
python "$XDG_CONFIG_HOME/opencode/skills/remote-compute/record_run.py" \
  --surface ssh --command "bash run.sh" --status <ok|failed> --host <host> \
  --hardware "<hardware>" --code run.sh --output results/<job-name>/<result file>
```

For a Slurm run use `--surface hpc`, `--command "sbatch <name>.sbatch"`,
`--job-id <id>`, and the `sacct` hardware/state. Use `--status failed` on a
non-success exit code / `sacct` state.

Summarize: the machine, the final state (quote the `exit_code`/`sacct` state —
do not assume success), elapsed time, and the fetched files. If it failed, show
the tail of `log` (or `slurm-<id>.err`) and propose a fix instead of silently
rerunning.
````

- [ ] **Step 5: Verify the skill parses and is bundled**

Run:
```bash
cd /Users/asq/data/workspace/desktop_project/open-ai4s-workbench && \
  head -3 runtime/skills/core/remote-compute/SKILL.md && \
  grep -rn "hpc-slurm" runtime/ apps/desktop/src apps/desktop/src-tauri/src 2>/dev/null || echo "no stale hpc-slurm references"
```
Expected: front-matter `name: remote-compute`; no stale `hpc-slurm` references in source (the bundled `skills-core/` copies the dir by its new name automatically).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(skill): remote-compute skill — pick a machine, direct-SSH or Slurm, record ssh runs"
```

---

### Task 9: End-to-end verification + DMG

**Files:** none (verification only).

- [ ] **Step 1: Full Rust + frontend test suites**

Run:
```bash
cd apps/desktop/src-tauri && cargo test 2>&1 | tail -15
cd apps/desktop && npx vitest run 2>&1 | tail -6 && npx tsc --noEmit -p tsconfig.json 2>&1 | head
```
Expected: all Rust tests pass; all frontend tests pass; tsc clean.

- [ ] **Step 2: Rebuild the DMG (user tests the installed app)**

Run:
```bash
cd apps/desktop && export PATH="$HOME/.cargo/bin:$PATH" && npx tauri build --bundles dmg 2>&1 | tail -6
```
Expected: "Finished 1 bundle" with the `.dmg` path.

- [ ] **Step 3: Update PROGRESS.md**

Prepend one line (newest on top) to `PROGRESS.md`:
```
2026-07-08 HH:MM · feat(remote-compute): generalized Cluster (HPC) → Remote compute — connect any SSH machine (CPU or GPU, Slurm optional), capability probe + usage snapshot, multi-machine compute.json (migrates hpc.json), agent remote-compute skill runs jobs directly (setsid+PID) or via Slurm. Rust + frontend tests green, DMG rebuilt.
```

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md && git commit -m "docs: progress — remote compute over SSH"
```

---

## Self-Review

**Spec coverage:**
- §1 probe/detection → Task 2 (parser) + Task 4 (`PROBE_SCRIPT`, `compute_probe`). ✓
- §2 data model + migration → Task 3 (parse/legacy) + Task 4 (`load_machines`/`save_machines`). ✓
- §3 long-job execution (setsid+PID+exit_code+kill pgroup) → Task 8 SKILL.md §2-Direct. ✓
- §4 agent skill (pick by caps, Slurm vs direct, record_run --surface ssh) → Task 8. ✓
- §5 RemoteComputeCard (chips, snapshot, Slurm queue, no queue error) → Task 6. ✓
- §6 backend commands (machines/add/remove/probe/jobs/cancel) → Task 4; renames/cleanup → Tasks 1, 7. ✓
- Safety (approval mode, is_safe_host/job_id, no install) → preserved (Task 1 rename keeps validators; commands reuse them). ✓
- Testing (probe parsing incl. noise, migration, card behaviors) → Tasks 2, 3, 6. ✓

**Type consistency:** `ComputeProbe`/`GpuInfo`/`Machine`/`Caps` fields match between Rust (Task 2/3) and TS (`ComputeProbe`/`GpuInfo`/`Machine`/`MachineCaps`, Task 5); the Rust `HpcJob` serializes to the TS `ComputeJob` shape (id/state/time/partition/name). Command names match bindings: `compute_machines`/`add_compute_machine`/`remove_compute_machine`/`compute_probe`/`compute_jobs`/`compute_cancel`. `capabilityChips`/`gpuSummary`/`fmtBytes` defined and used within Task 6.

**Placeholder scan:** none — every code step has complete code; every run step has a command + expected result.
