// AI4S Workbench — Tauri 2 entry. Hosts the React frontend and supervises the
// bundled OpenCode sidecar (isolated config/data + dedicated port; killed on exit).
mod artifact_file;
mod debug_log;
mod jupyter;
mod kernel;
mod opencode_config;
mod preview_server;
mod runtime;
mod tools;

use jupyter::JupyterState;
use kernel::KernelState;
use preview_server::PreviewState;
use runtime::RuntimeState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance MUST be the first plugin. A second launch (or a reinstall
        // while the app is still running) focuses the existing window instead of
        // starting a second OpenCode on the same data dir (which deadlocks the DB).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeState::default())
        .manage(KernelState::default())
        .manage(JupyterState::default())
        .manage(PreviewState::default())
        .invoke_handler(tauri::generate_handler![
            runtime::start_runtime,
            runtime::stop_runtime,
            runtime::workspace_path,
            runtime::import_opencode_login,
            runtime::remove_config_entry,
            jupyter::jupyter_status,
            jupyter::setup_jupyter,
            jupyter::start_jupyter,
            runtime::configure_opencode,
            kernel::kernel_execute,
            kernel::kernel_reset,
            artifact_file::read_artifact,
            artifact_file::open_path,
            artifact_file::resolve_artifact,
            artifact_file::save_text_file,
            artifact_file::open_url,
            artifact_file::add_files_to_workspace,
            artifact_file::add_text_to_workspace,
            artifact_file::list_notebooks,
            artifact_file::write_workspace_file,
            preview_server::preview_url,
            tools::detect_tools,
            debug_log::log_debug
        ])
        .build(tauri::generate_context!())
        .expect("error while building AI4S Workbench")
        .run(|app, event| {
            // Ensure the bundled OpenCode is killed when the app exits.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                runtime::kill_child(&app.state::<RuntimeState>());
                kernel::kill_kernel(&app.state::<KernelState>());
                jupyter::kill_jupyter(&app.state::<JupyterState>());
            }
        });
}
