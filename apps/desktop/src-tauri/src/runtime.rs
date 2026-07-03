// Manages the bundled OpenCode sidecar so it never interferes with any OpenCode
// the user already has: it runs the *bundled* binary, on a *dedicated free port*,
// with an *app-private* XDG config/data dir, and is killed on app exit.
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

use crate::opencode_config::merge_config;

#[derive(Default)]
pub struct RuntimeState {
    child: Mutex<Option<CommandChild>>,
    url: Mutex<Option<String>>,
    port: Mutex<Option<u16>>,
}

/// App-private runtime root, e.g. ~/Library/Application Support/com.ai4s.workbench/runtime
fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime"))
}

fn xdg_config_home(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("xdg-config"))
}

/// The workspace OpenCode (and the notebook kernel) runs in — the agent's files live here.
pub fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = runtime_root(app)?.join("workspace");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Path OpenCode reads when XDG_CONFIG_HOME points at our private dir.
fn opencode_config_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(xdg_config_home(app)?.join("opencode").join("opencode.json"))
}

/// The user's existing OpenCode auth file (their login / free credits), if any.
/// Read-only: we copy it into our sandbox so the bundled runtime can use the same
/// login, but we never modify the user's file or sessions.
fn user_auth_source() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            candidates.push(PathBuf::from(xdg).join("opencode").join("auth.json"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".local/share/opencode/auth.json"));
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("opencode").join("auth.json"));
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Copy the user's OpenCode login into the app-private data dir so the bundled
/// runtime uses the same credentials (e.g. free/oauth access). Sessions stay isolated.
fn seed_auth(data_dir: &PathBuf) {
    if let Some(src) = user_auth_source() {
        let dst = data_dir.join("opencode").join("auth.json");
        if let Some(parent) = dst.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::copy(&src, &dst);
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(43917)
}

fn spawn_sidecar(app: &AppHandle, port: u16) -> Result<CommandChild, String> {
    let root = runtime_root(app)?;
    let cfg = root.join("xdg-config");
    let data = root.join("xdg-data");
    let cache = root.join("xdg-cache");
    let state = root.join("xdg-state");
    // Run OpenCode inside a small app workspace, NOT the app's cwd (which is `/` when
    // launched from Finder) — otherwise it scans the whole filesystem root and is slow.
    let workspace = root.join("workspace");
    for d in [&cfg, &data, &cache, &state, &workspace] {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    // Share the user's OpenCode login (free credits) without touching their sessions.
    seed_auth(&data);
    let home = std::env::var("HOME").unwrap_or_default();
    let port_str = port.to_string();

    let cmd = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| format!("sidecar not found: {e}"))?
        .args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            port_str.as_str(),
            "--cors",
            "*",
        ])
        // App-private dirs: OpenCode never touches the user's ~/.config/opencode.
        .env("XDG_CONFIG_HOME", cfg.to_string_lossy().to_string())
        .env("XDG_DATA_HOME", data.to_string_lossy().to_string())
        .env("XDG_CACHE_HOME", cache.to_string_lossy().to_string())
        .env("XDG_STATE_HOME", state.to_string_lossy().to_string())
        .env("HOME", home)
        .current_dir(workspace);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("failed to spawn opencode: {e}"))?;
    // Drain events so the child's stdout/stderr buffer never blocks it.
    tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
    Ok(child)
}

/// Start the bundled OpenCode (idempotent). Returns its base URL.
#[tauri::command]
pub fn start_runtime(app: AppHandle, state: State<'_, RuntimeState>) -> Result<String, String> {
    if let Some(url) = state.url.lock().unwrap().clone() {
        return Ok(url);
    }
    // Reuse a stable port across restarts so the frontend URL doesn't change.
    let port = {
        let mut p = state.port.lock().unwrap();
        *p.get_or_insert_with(free_port)
    };
    let child = spawn_sidecar(&app, port)?;
    let url = format!("http://127.0.0.1:{port}");
    *state.child.lock().unwrap() = Some(child);
    *state.url.lock().unwrap() = Some(url.clone());
    Ok(url)
}

/// Kill the bundled OpenCode if running.
#[tauri::command]
pub fn stop_runtime(state: State<'_, RuntimeState>) {
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    *state.url.lock().unwrap() = None;
}

pub fn kill_child(state: &RuntimeState) {
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

/// Write the provider key/model into the app-private OpenCode config and restart
/// the sidecar so it picks them up. Returns the same base URL (stable port).
#[tauri::command]
pub fn configure_opencode(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
) -> Result<String, String> {
    let path = opencode_config_file(&app)?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let merged = merge_config(&existing, &provider, &api_key, &model, base_url.as_deref())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, merged).map_err(|e| e.to_string())?;

    // Restart so the running server reloads the new provider config.
    let was_running = state.url.lock().unwrap().is_some();
    if was_running {
        kill_child(&state);
        let port = { *state.port.lock().unwrap().get_or_insert_with(free_port) };
        let child = spawn_sidecar(&app, port)?;
        *state.child.lock().unwrap() = Some(child);
        let url = format!("http://127.0.0.1:{port}");
        *state.url.lock().unwrap() = Some(url.clone());
        Ok(url)
    } else {
        Ok(path.to_string_lossy().to_string())
    }
}
