// Built-in example projects (P0-1 / P1-1) — Tauri wrapper over
// shell_core::assets. Real, small datasets bundled as resources and copied
// into the workspace on demand.
use tauri::AppHandle;

/// Copy a bundled example project into the workspace (idempotent, never
/// overwrites) and return its workspace-relative directory name.
#[tauri::command(async)]
pub fn install_example(app: AppHandle, name: String) -> Result<String, String> {
    shell_core::assets::install_example(&crate::runtime::ctx(&app)?, &name)
}
