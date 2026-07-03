// Optional Jupyter integration for the Jupyter MCP server: the bundled `uv`
// sidecar provisions an ISOLATED environment (own managed Python — nothing on
// the user's machine is touched) under app data, and the app manages a
// headless jupyter-lab process the MCP server connects to.
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

use crate::runtime::{free_port, workspace_dir};

// Pinned per datalayer/jupyter-mcp-server's documented requirements.
const PIP_SPEC: &[&str] = &[
    "jupyterlab==4.4.1",
    "jupyter-collaboration==4.0.2",
    "jupyter-mcp-server",
    "ipykernel",
];

#[derive(Default)]
pub struct JupyterState {
    child: Mutex<Option<CommandChild>>,
    running: Mutex<bool>,
}

fn env_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("jupyter-env"))
}

fn server_meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(env_dir(app)?.join("server.json"))
}

fn bin(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = env_dir(app)?;
    #[cfg(windows)]
    return Ok(dir.join("Scripts").join(format!("{name}.exe")));
    #[cfg(not(windows))]
    Ok(dir.join("bin").join(name))
}

/// Port + token are chosen once at setup and reused so the MCP config entry
/// (which carries JUPYTER_URL/JUPYTER_TOKEN) stays valid across app restarts.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ServerMeta {
    port: u16,
    token: String,
}

fn load_meta(app: &AppHandle) -> Option<ServerMeta> {
    let text = std::fs::read_to_string(server_meta_path(app).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn random_token() -> String {
    #[cfg(unix)]
    {
        use std::io::Read;
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            let mut buf = [0u8; 16];
            if f.read_exact(&mut buf).is_ok() {
                return buf.iter().map(|b| format!("{b:02x}")).collect();
            }
        }
    }
    format!(
        "{:x}{:x}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

#[derive(serde::Serialize)]
pub struct JupyterStatus {
    pub installed: bool,
    pub running: bool,
    pub url: Option<String>,
    pub token: Option<String>,
    /// Absolute jupyter-mcp-server path for the MCP config entry.
    pub mcp_command: Option<String>,
}

fn status_of(app: &AppHandle, state: &JupyterState) -> JupyterStatus {
    let installed = bin(app, "jupyter-lab").map(|p| p.exists()).unwrap_or(false);
    let running = *state.running.lock().unwrap();
    let meta = load_meta(app);
    JupyterStatus {
        installed,
        running,
        url: meta.as_ref().map(|m| format!("http://127.0.0.1:{}", m.port)),
        token: meta.map(|m| m.token),
        mcp_command: bin(app, "jupyter-mcp-server")
            .ok()
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn jupyter_status(app: AppHandle, state: State<'_, JupyterState>) -> JupyterStatus {
    status_of(&app, &state)
}

/// Provision the isolated Jupyter environment with the bundled uv. First run
/// downloads a managed Python + JupyterLab (a few hundred MB into app data);
/// takes a few minutes. Async so the UI stays responsive.
#[tauri::command]
pub async fn setup_jupyter(app: AppHandle) -> Result<(), String> {
    let dir = env_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let venv = app
        .shell()
        .sidecar("uv")
        .map_err(|e| format!("uv sidecar not found: {e}"))?
        .args(["venv", &dir.to_string_lossy(), "--python", "3.12", "--allow-existing"])
        .output()
        .await
        .map_err(|e| format!("uv venv failed to run: {e}"))?;
    if !venv.status.success() {
        return Err(format!("uv venv failed: {}", String::from_utf8_lossy(&venv.stderr)));
    }

    let py = bin(&app, "python")?;
    let mut args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        py.to_string_lossy().to_string(),
    ];
    args.extend(PIP_SPEC.iter().map(|s| s.to_string()));
    let install = app
        .shell()
        .sidecar("uv")
        .map_err(|e| format!("uv sidecar not found: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("uv pip install failed to run: {e}"))?;
    if !install.status.success() {
        return Err(format!(
            "uv pip install failed: {}",
            String::from_utf8_lossy(&install.stderr)
        ));
    }

    // Fix port + token once so the MCP config entry stays valid.
    if load_meta(&app).is_none() {
        let meta = ServerMeta { port: free_port(), token: random_token() };
        std::fs::write(
            server_meta_path(&app)?,
            serde_json::to_string(&meta).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Start the managed headless jupyter-lab (idempotent). Root dir = workspace,
/// so the agent and the app's Notebooks page see the same files.
#[tauri::command]
pub fn start_jupyter(app: AppHandle, state: State<'_, JupyterState>) -> Result<JupyterStatus, String> {
    if *state.running.lock().unwrap() {
        return Ok(status_of(&app, &state));
    }
    let lab = bin(&app, "jupyter-lab")?;
    if !lab.exists() {
        return Err("Jupyter is not set up yet".into());
    }
    let meta = load_meta(&app).ok_or("Jupyter setup is incomplete (no server meta)")?;
    let workspace = workspace_dir(&app)?;

    // Kill any orphaned jupyter-lab from a previous app run (a crash or force
    // quit leaves one behind; two instances then fight over the fixed port).
    #[cfg(unix)]
    {
        let pattern = format!("{}/bin/jupyter-lab", env_dir(&app)?.to_string_lossy());
        let _ = std::process::Command::new("pkill").args(["-f", &pattern]).output();
        std::thread::sleep(std::time::Duration::from_millis(400));
    }

    let cmd = app
        .shell()
        .command(lab.to_string_lossy().to_string())
        .args([
            "--no-browser".to_string(),
            "--ip".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            meta.port.to_string(),
            format!("--IdentityProvider.token={}", meta.token),
            format!("--ServerApp.root_dir={}", workspace.to_string_lossy()),
        ])
        .current_dir(workspace);
    let (mut rx, child) = cmd.spawn().map_err(|e| format!("failed to start jupyter: {e}"))?;
    tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
    *state.child.lock().unwrap() = Some(child);
    *state.running.lock().unwrap() = true;
    Ok(status_of(&app, &state))
}

pub fn kill_jupyter(state: &JupyterState) {
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    *state.running.lock().unwrap() = false;
}
