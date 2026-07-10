// Manages the bundled OpenCode sidecar so it never interferes with any OpenCode
// the user already has: it runs the *bundled* binary, on a *dedicated free port*,
// with an *app-private* XDG config/data dir, and is killed on app exit.
//
// The command bodies live in the shared `shell-core` crate (the web server runs
// the same ones); this module supplies the Tauri context (paths from AppHandle),
// the sidecar spawn via tauri_plugin_shell, and the thin #[tauri::command]
// wrappers the frontend invokes.
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Shared utilities other desktop modules (kernel, jupyter, compute, …) reach
// through `crate::runtime::` — same paths as before the shell-core extraction.
pub(crate) use shell_core::util::{enriched_path, free_port, quiet_command, random_hex};
use shell_core::util::server_password;
use shell_core::ShellCtx;

#[derive(Default)]
pub struct RuntimeState {
    child: Mutex<Option<CommandChild>>,
    url: Mutex<Option<String>>,
    port: Mutex<Option<u16>>,
}

/// The shared-command context for this app run: app-private data dir, the OS
/// documents dir, the bundled-resource dir, and the app version.
pub(crate) fn ctx(app: &AppHandle) -> Result<ShellCtx, String> {
    Ok(ShellCtx {
        data_dir: app.path().app_data_dir().map_err(|e| e.to_string())?,
        document_dir: app.path().document_dir().ok(),
        resource_dir: app.path().resource_dir().ok(),
        app_version: app.package_info().version.to_string(),
    })
}

/// The active workspace folder (see shell_core::ctx::workspace_dir).
pub fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    shell_core::ctx::workspace_dir(&ctx(app)?)
}

/// The workspace root new dated session folders are created under.
pub fn base_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    shell_core::ctx::base_workspace_dir(&ctx(app)?)
}

/// Expose the per-run sidecar password to the frontend SDK client.
#[tauri::command]
pub fn runtime_password() -> String {
    server_password().to_string()
}

/// Copy the user's OpenCode CLI login into the app-private data dir, EXPLICITLY
/// (from the Settings page) — never silently. Returns false when there is no
/// CLI login to import. Restarts the sidecar so it picks the credentials up.
#[tauri::command(async)]
pub fn import_opencode_login(app: AppHandle, state: State<'_, RuntimeState>) -> Result<bool, String> {
    if !shell_core::runtime::import_opencode_login(&ctx(&app)?)? {
        return Ok(false);
    }
    // Restart the running sidecar so /config/providers reflects the login.
    if state.url.lock().unwrap().is_some() {
        restart_sidecar(&app, &state)?;
    }
    Ok(true)
}

fn spawn_sidecar(app: &AppHandle, port: u16) -> Result<CommandChild, String> {
    let spec = shell_core::runtime::build_sidecar_spec(&ctx(app)?, port)?;
    let mut cmd = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| format!("sidecar not found: {e}"))?
        .args(spec.args)
        .current_dir(spec.cwd);
    for (k, v) in spec.envs {
        cmd = cmd.env(k, v);
    }
    let (mut rx, child) = cmd.spawn().map_err(|e| format!("failed to spawn opencode: {e}"))?;
    // Drain events so the child's stdout/stderr buffer never blocks it.
    tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
    Ok(child)
}

/// Kill and respawn the sidecar on its stable port, returning the base URL.
/// The whole kill→spawn runs while HOLDING the child mutex — it doubles as
/// the lifecycle lock, so two concurrent restarts (e.g. Settings saves racing
/// an approval-mode switch) can never double-spawn and orphan a child. This
/// is the single restart path; config-changing commands must use it.
fn restart_sidecar(app: &AppHandle, state: &RuntimeState) -> Result<String, String> {
    let mut child = state.child.lock().unwrap();
    if let Some(c) = child.take() {
        let _ = c.kill();
    }
    let port = { *state.port.lock().unwrap().get_or_insert_with(free_port) };
    *child = Some(spawn_sidecar(app, port)?);
    let url = format!("http://127.0.0.1:{port}");
    *state.url.lock().unwrap() = Some(url.clone());
    Ok(url)
}

/// Start the bundled OpenCode (idempotent). Returns its base URL. `async`:
/// skill-pack deployment + process spawn at startup must not block the UI
/// thread while the first window paints.
#[tauri::command(async)]
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

/// The workspace directory the sidecar runs in — the frontend passes it to the
/// SDK so skill discovery is scoped to the right OpenCode instance.
#[tauri::command]
pub fn workspace_path(app: AppHandle) -> Result<String, String> {
    Ok(workspace_dir(&app)?.to_string_lossy().to_string())
}

/// The base folder new dated workspaces are created under (`~/Documents/OpenScience`).
#[tauri::command]
pub fn workspace_base(app: AppHandle) -> Result<String, String> {
    Ok(base_workspace_dir(&app)?.to_string_lossy().to_string())
}

/// Choose the base folder (Settings → Workspace → Change). Creates it if
/// needed and persists the choice; every NEW session's dated folder is created
/// under it. Existing sessions keep their folders.
#[tauri::command]
pub fn set_workspace_base(app: AppHandle, path: String) -> Result<String, String> {
    shell_core::runtime::set_workspace_base(&ctx(&app)?, &path)
}

/// Reveal the base workspace folder in the OS file manager. (The sandboxed
/// `open_path` resolves inside the ACTIVE workspace only, which may be a dated
/// subfolder — the base needs its own door.)
#[tauri::command]
pub fn open_workspace_base(app: AppHandle) -> Result<(), String> {
    crate::artifact_file::os_open(&base_workspace_dir(&app)?)
}

/// Switch the active workspace folder (no sidecar restart — the frontend
/// reconnects its event stream with `?directory=`). Desktop extras: re-root
/// the pinned Jupyter lab and refresh the remote-machine list for the session.
#[tauri::command(async)]
pub fn set_workspace(
    app: AppHandle,
    _state: State<'_, RuntimeState>,
    path: String,
) -> Result<String, String> {
    let canon = shell_core::runtime::set_workspace(&ctx(&app)?, &path)?;
    // Jupyter-lab pins its root_dir at spawn time — re-root it (in the
    // background) so agent-created notebooks land in the new folder.
    crate::jupyter::reroot_jupyter(&app);
    // Refresh this session's local copy of the remote-machine list from the
    // canonical base file, so a machine configured in Settings is visible to
    // every session's agent without reaching outside the workspace.
    crate::compute::materialize_active(&app);
    Ok(canon)
}

/// Record which session owns the active workspace (written to
/// `.openscience/session.txt`) so skill helpers can attribute remote runs.
#[tauri::command]
pub fn mark_session(app: AppHandle, session_id: String) -> Result<(), String> {
    shell_core::runtime::mark_session(&ctx(&app)?, &session_id)
}

/// Create a new dated folder `<base>/<name>` and switch to it (harness seeded,
/// initial git snapshot taken). Desktop extras as in `set_workspace`.
#[tauri::command(async)]
pub fn new_dated_workspace(
    app: AppHandle,
    _state: State<'_, RuntimeState>,
    name: String,
) -> Result<String, String> {
    let canon = shell_core::runtime::new_dated_workspace(&ctx(&app)?, &name)?;
    crate::jupyter::reroot_jupyter(&app);
    crate::compute::materialize_active(&app);
    Ok(canon)
}

/// Native "choose a folder" dialog; returns the absolute path, or None on cancel.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
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

/// Remove an entry from a map section of the app-private global OpenCode
/// config ("provider" or "mcp") and restart the sidecar (PATCH /global/config
/// cannot delete keys).
#[tauri::command(async)]
pub fn remove_config_entry(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    section: String,
    key: String,
) -> Result<(), String> {
    shell_core::runtime::remove_config_entry(&ctx(&app)?, &section, &key)?;
    if state.url.lock().unwrap().is_some() {
        restart_sidecar(&app, &state)?;
    }
    Ok(())
}

/// The current approval mode ("approve" | "full"). Spawn seeding guarantees a
/// mode exists once the runtime has started; before that, report the default.
#[tauri::command]
pub fn get_approval_mode(app: AppHandle) -> Result<String, String> {
    shell_core::runtime::get_approval_mode(&ctx(&app)?)
}

/// Switch the approval mode and restart the sidecar so the permission rules
/// take effect. Returns the (stable-port) base URL when it was running.
#[tauri::command(async)]
pub fn set_approval_mode(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    mode: String,
) -> Result<String, String> {
    let path = shell_core::runtime::set_approval_mode(&ctx(&app)?, &mode)?;
    // Same restart flow as configure_opencode: reload rules on a stable port.
    if state.url.lock().unwrap().is_some() {
        restart_sidecar(&app, &state)
    } else {
        Ok(path.to_string_lossy().to_string())
    }
}

/// The persisted proxy setting plus the proxy the sidecar would use right now.
#[tauri::command]
pub fn get_proxy_setting(app: AppHandle) -> Result<shell_core::runtime::ProxySetting, String> {
    Ok(shell_core::runtime::get_proxy_setting(&ctx(&app)?))
}

/// Persist the proxy setting ("system" | "custom" | "none", url for custom)
/// and restart the sidecar so its network env takes effect.
#[tauri::command(async)]
pub fn set_proxy_setting(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    mode: String,
    url: String,
) -> Result<String, String> {
    let path = shell_core::runtime::set_proxy_setting(&ctx(&app)?, &mode, &url)?;
    // Same restart flow as set_approval_mode: the env only applies at spawn.
    if state.url.lock().unwrap().is_some() {
        restart_sidecar(&app, &state)
    } else {
        Ok(path.to_string_lossy().to_string())
    }
}

/// Write the provider key/model into the app-private OpenCode config and restart
/// the sidecar so it picks them up. Returns the same base URL (stable port).
#[tauri::command(async)]
pub fn configure_opencode(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
) -> Result<String, String> {
    let path = shell_core::runtime::configure_opencode(
        &ctx(&app)?,
        &provider,
        &api_key,
        &model,
        base_url.as_deref(),
    )?;
    // Restart so the running server reloads the new provider config.
    if state.url.lock().unwrap().is_some() {
        restart_sidecar(&app, &state)
    } else {
        Ok(path.to_string_lossy().to_string())
    }
}
