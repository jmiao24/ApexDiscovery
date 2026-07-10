// Runs read-model — Tauri wrapper over shell_core::runs_index (a disposable
// SQLite index derived from the append-only runs logs, serving fast keyset-
// paginated, faceted, searched queries).
use tauri::AppHandle;

use shell_core::runs_index::{self, RunPage, RunQuery};

use crate::runtime::base_workspace_dir;

/// `async`: opens + syncs the index (reads new log bytes, writes the DB) and
/// queries it — none of which may run on the UI thread.
#[tauri::command(async)]
pub fn query_runs_cmd(app: AppHandle, query: RunQuery) -> Result<RunPage, String> {
    // Global index, keyed to the base folder: it aggregates every session's
    // logs. The Runs page queries it unfiltered; a session's Runs pane passes
    // `sessionId` to narrow to its own runs.
    runs_index::query_runs_synced(&base_workspace_dir(&app)?, &query)
}
