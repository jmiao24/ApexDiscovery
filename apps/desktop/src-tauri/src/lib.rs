// AI4S Workbench — Tauri 2 entry. The desktop shell hosts the React frontend and
// (in a later step) supervises the bundled Hermes sidecar.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running AI4S Workbench");
}
