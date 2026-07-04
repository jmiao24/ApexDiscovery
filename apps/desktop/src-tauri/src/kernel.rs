// A local Python kernel for the notebook. Spawns `kernel_bridge.py` (see
// runtime/kernel/) as a persistent child and talks its line-delimited JSON
// protocol synchronously: write one request, read one response. Fully local —
// uses whatever Python is installed, no network, no model key.
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

// The bridge script ships in-tree; embed it and materialize it on first use so it
// is always present next to the app regardless of packaging.
const BRIDGE_SRC: &str = include_str!("../../../../runtime/kernel/kernel_bridge.py");

struct Kernel {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    seq: u64,
}

#[derive(Default)]
pub struct KernelState(Mutex<Option<Kernel>>);

#[derive(serde::Serialize)]
pub struct ExecResult {
    ok: bool,
    stdout: String,
    result: Option<String>,
    error: Option<String>,
}

fn bridge_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("kernel");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("kernel_bridge.py");
    // Rewrite each start so an app update ships a fresh bridge.
    std::fs::write(&path, BRIDGE_SRC).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Common Python install locations per OS. A GUI app launched from Finder/Explorer
/// has a minimal PATH, so we fall back to these before giving up.
#[cfg(windows)]
fn python_candidates() -> Vec<String> {
    // `py` (the launcher) and `python` are what Windows installers register.
    let mut c = vec!["py".to_string(), "python".to_string(), "python3".to_string()];
    if let Ok(profile) = std::env::var("USERPROFILE") {
        c.push(format!("{profile}\\anaconda3\\python.exe"));
        c.push(format!("{profile}\\miniconda3\\python.exe"));
        c.push(format!("{profile}\\AppData\\Local\\Programs\\Python\\python.exe"));
    }
    c
}

#[cfg(not(windows))]
fn python_candidates() -> Vec<String> {
    let mut c = vec!["python3".to_string(), "python".to_string()];
    if let Ok(home) = std::env::var("HOME") {
        c.push(format!("{home}/anaconda3/bin/python3"));
        c.push(format!("{home}/miniconda3/bin/python3"));
        c.push(format!("{home}/.pyenv/shims/python3"));
    }
    c.extend(
        [
            "/opt/anaconda3/bin/python3",
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ]
        .map(String::from),
    );
    c
}

pub(crate) fn python_bin() -> Option<String> {
    python_candidates()
        .into_iter()
        .find(|bin| Command::new(bin).arg("--version").output().is_ok())
}

fn spawn_kernel(app: &AppHandle) -> Result<Kernel, String> {
    let script = bridge_path(app)?;
    let python = python_bin()
        .ok_or("no Python found — install Python 3 to use the local notebook kernel")?;
    // Run in the agent's workspace so notebook code sees the same files it produced.
    let workspace = crate::runtime::workspace_dir(app)?;
    let mut child = Command::new(python)
        .arg(script)
        .current_dir(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start Python kernel: {e}"))?;
    let stdin = child.stdin.take().ok_or("no kernel stdin")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("no kernel stdout")?);
    Ok(Kernel { child, stdin, stdout, seq: 0 })
}

/// Execute one cell in the persistent local kernel (starting it on first use).
#[tauri::command]
pub fn kernel_execute(
    app: AppHandle,
    state: State<'_, KernelState>,
    code: String,
) -> Result<ExecResult, String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_none() {
        *guard = Some(spawn_kernel(&app)?);
    }
    let k = guard.as_mut().unwrap();
    k.seq += 1;
    let req = serde_json::json!({ "id": k.seq.to_string(), "code": code });
    writeln!(k.stdin, "{req}").map_err(|e| format!("kernel write failed: {e}"))?;
    k.stdin.flush().map_err(|e| format!("kernel flush failed: {e}"))?;

    let mut line = String::new();
    let n = k
        .stdout
        .read_line(&mut line)
        .map_err(|e| format!("kernel read failed: {e}"))?;
    if n == 0 {
        // The child died; drop it so the next call respawns a clean kernel.
        *guard = None;
        return Err("kernel exited unexpectedly".into());
    }
    let v: serde_json::Value =
        serde_json::from_str(line.trim()).map_err(|e| format!("bad kernel response: {e}"))?;
    Ok(ExecResult {
        ok: v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false),
        stdout: v.get("stdout").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        result: v.get("result").and_then(|x| x.as_str()).map(str::to_string),
        error: v.get("error").and_then(|x| x.as_str()).map(str::to_string),
    })
}

/// Restart the kernel (clears all state).
#[tauri::command]
pub fn kernel_reset(state: State<'_, KernelState>) {
    if let Some(mut k) = state.0.lock().unwrap().take() {
        let _ = k.child.kill();
    }
}

pub fn kill_kernel(state: &KernelState) {
    if let Some(mut k) = state.0.lock().unwrap().take() {
        let _ = k.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Drives the real in-tree bridge with the same write-line / read-line protocol
    // kernel_execute uses, proving the Rust <-> Python round trip and shared state.
    #[test]
    fn round_trips_and_keeps_state() {
        let Some(python) = python_bin() else {
            eprintln!("skipping: no python found");
            return;
        };
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../runtime/kernel/kernel_bridge.py");
        let mut child = Command::new(python)
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn bridge");
        let mut stdin = child.stdin.take().unwrap();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());

        let read = |stdout: &mut BufReader<ChildStdout>| -> serde_json::Value {
            let mut line = String::new();
            stdout.read_line(&mut line).unwrap();
            serde_json::from_str(line.trim()).unwrap()
        };

        writeln!(stdin, "{}", serde_json::json!({"id":"1","code":"a=41\na+1"})).unwrap();
        stdin.flush().unwrap();
        let r1 = read(&mut stdout);
        assert_eq!(r1["ok"], true);
        assert_eq!(r1["result"], "42");

        // Second cell sees `a` from the first — persistent shared namespace.
        writeln!(stdin, "{}", serde_json::json!({"id":"2","code":"a"})).unwrap();
        stdin.flush().unwrap();
        let r2 = read(&mut stdout);
        assert_eq!(r2["result"], "41");

        // Errors come back as ok:false with a traceback.
        writeln!(stdin, "{}", serde_json::json!({"id":"3","code":"1/0"})).unwrap();
        stdin.flush().unwrap();
        let r3 = read(&mut stdout);
        assert_eq!(r3["ok"], false);
        assert!(r3["error"].as_str().unwrap().contains("ZeroDivisionError"));

        let _ = child.kill();
    }
}
