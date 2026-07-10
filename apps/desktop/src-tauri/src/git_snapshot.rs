// Best-effort local git snapshots of the workspace — Tauri wrapper over
// shell_core::git_snapshot (marker-gated so a repo the user brought in is
// never touched; never sets a remote or pushes).
use tauri::AppHandle;

#[tauri::command(async)]
pub fn commit_workspace_snapshot(app: AppHandle, message: String) -> Result<bool, String> {
    let root = crate::runtime::workspace_dir(&app)?;
    shell_core::git_snapshot::commit(&root, &message)
}
