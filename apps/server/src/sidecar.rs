// Agent sidecar supervision for the server: the same spawn recipe as the
// desktop (shell_core::runtime::build_sidecar_spec — app-private XDG profile,
// per-run password, enriched PATH, proxy env), launched with std::process and
// killed on exit/restart.
use std::path::{Path, PathBuf};
use std::process::Child;

use shell_core::util::free_port;
use shell_core::ShellCtx;

/// Locate the bundled Codex-backed APEX Runtime bridge.
pub fn default_runtime_bin() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let codex = dir.join("codex-bridge").join("src").join("server.mjs");
            if codex.is_file() {
                return codex;
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let codex = cwd
            .join("apps")
            .join("codex-bridge")
            .join("src")
            .join("server.mjs");
        if codex.is_file() {
            return codex;
        }
    }
    PathBuf::from("apps/codex-bridge/src/server.mjs")
}

#[derive(Default)]
pub struct Sidecar {
    child: Option<Child>,
    port: Option<u16>,
    url: Option<String>,
}

impl Sidecar {
    pub fn url(&self) -> Option<String> {
        self.url.clone()
    }

    /// Start if not already running (idempotent); returns the base URL.
    pub fn ensure_started(&mut self, ctx: &ShellCtx, bin: &Path) -> Result<String, String> {
        if let Some(url) = &self.url {
            return Ok(url.clone());
        }
        self.spawn(ctx, bin)
    }

    /// Kill and respawn on the stable port. This runs under the state's
    /// sidecar mutex, so concurrent restarts can never double-spawn.
    pub fn restart(&mut self, ctx: &ShellCtx, bin: &Path) -> Result<String, String> {
        self.kill();
        self.spawn(ctx, bin)
    }

    fn spawn(&mut self, ctx: &ShellCtx, bin: &Path) -> Result<String, String> {
        // Reuse a stable port across restarts so the proxy target never moves.
        let port = *self.port.get_or_insert_with(free_port);
        let spec = shell_core::runtime::build_sidecar_spec(ctx, port)?;
        // JavaScript bridges use an explicit Node executable so the same
        // packaged layout works on Windows, where shebang execution is unavailable.
        let is_node_script = matches!(
            bin.extension().and_then(|extension| extension.to_str()),
            Some("js" | "mjs" | "cjs")
        );
        let mut cmd = if is_node_script {
            let node = std::env::var("APEX_NODE_BIN").unwrap_or_else(|_| "node".to_string());
            let mut command = shell_core::util::quiet_command(&node);
            command.arg(bin);
            command
        } else {
            shell_core::util::quiet_command(bin)
        };
        cmd.args(&spec.args)
            .current_dir(&spec.cwd)
            // The server's own stdio is the operator's log; the sidecar's
            // output goes there too (it's how the desktop drains it as well).
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit());
        for (k, v) in &spec.envs {
            cmd.env(k, v);
        }
        // The Codex bridge reads the extension inventory on every turn.
        cmd.env("APEX_EXTENSIONS_DIR", ctx.data_dir.join("extensions"));
        let child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn agent sidecar ({}): {e}", bin.display()))?;
        let url = format!("http://127.0.0.1:{port}");
        self.child = Some(child);
        self.url = Some(url.clone());
        Ok(url)
    }

    pub fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.url = None;
    }
}
