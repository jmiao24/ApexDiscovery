// Appends frontend diagnostics to <app-data>/debug.log — Tauri wrapper over
// shell_core::debug_log.
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn log_debug(app: AppHandle, message: String) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    shell_core::debug_log::log_debug(&dir, &message);
}
