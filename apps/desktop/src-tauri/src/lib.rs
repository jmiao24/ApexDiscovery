// AI4S Workbench — Tauri 2 entry. The desktop shell hosts the React frontend and
// (in a later step) supervises the bundled OpenCode sidecar.
mod opencode_config;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![opencode_config::configure_opencode])
        .run(tauri::generate_context!())
        .expect("error while running AI4S Workbench");
}
