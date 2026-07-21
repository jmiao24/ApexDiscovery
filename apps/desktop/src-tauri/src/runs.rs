// Run provenance (reproducibility recipe) — Tauri wrappers over
// shell_core::runs. Every agent experiment execution appends a run record to
// <workspace>/.apex-discovery/runs.jsonl; a run-produced file's provenance version
// carries the run's id, so an artifact links back to its recipe.
use tauri::AppHandle;

pub use shell_core::runs::RunState;
use shell_core::runs::{self, RunRecord};

use crate::provenance::ProvenanceState;
use crate::runtime::workspace_dir;

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
    let env = crate::provenance::capture_env(&app, &root);
    // Now hold RunState (serializes runs.jsonl) AND ProvenanceState (serializes
    // provenance.jsonl, shared with record_provenance) — record_run writes both
    // stores. Only this path takes both, always in this order, so no deadlock.
    let _guard = state.0.lock().map_err(|_| "run lock poisoned")?;
    let _prov_guard = prov_state.0.lock().map_err(|_| "provenance lock poisoned")?;
    let record = runs::record_run_inner(
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
    )?;
    drop(_prov_guard);
    drop(_guard);
    shell_core::git_snapshot::commit_best_effort(&root, &format!("Record run {}", record.run_id));
    Ok(record)
}

/// `async`: reads the whole (unbounded) runs store off the UI thread.
#[tauri::command(async)]
pub fn list_runs(app: AppHandle) -> Result<Vec<RunRecord>, String> {
    Ok(runs::read_runs(&workspace_dir(&app)?))
}

/// Read a run's captured stdout/stderr by its log hash.
#[tauri::command(async)]
pub fn read_run_log(app: AppHandle, hash: String) -> Result<String, String> {
    runs::read_log(&workspace_dir(&app)?, &hash)
}
