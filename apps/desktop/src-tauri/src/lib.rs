// AI4S Workbench — Tauri 2 entry. Hosts the React frontend and supervises the
// bundled OpenCode sidecar (isolated config/data + dedicated port; killed on exit).
mod opencode_config;
mod runtime;
mod tools;

use runtime::RuntimeState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(RuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            runtime::start_runtime,
            runtime::stop_runtime,
            runtime::configure_opencode,
            tools::detect_tools
        ])
        .build(tauri::generate_context!())
        .expect("error while building AI4S Workbench")
        .run(|app, event| {
            // Ensure the bundled OpenCode is killed when the app exits.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                runtime::kill_child(&app.state::<RuntimeState>());
            }
        });
}
