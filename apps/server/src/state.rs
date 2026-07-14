// Shared server state: the ShellCtx every command uses, the login token, and
// the supervised agent sidecar (port + process + base URL).
use std::path::PathBuf;

use shell_core::ShellCtx;
use tokio::sync::Mutex;

use crate::sidecar;

pub struct AppState {
    pub ctx: ShellCtx,
    /// Operator token for manual login / programmatic Bearer access. Normal
    /// localhost launches use the one-time bootstrap nonce instead.
    pub access_token: String,
    /// Random cookie value, separate from both operator and bootstrap tokens.
    pub session_token: String,
    pub bootstrap_nonce: Mutex<Option<String>>,
    pub opencode_bin: PathBuf,
    /// Sidecar lifecycle — the mutex doubles as the restart lock so two
    /// config-changing commands can never double-spawn (same invariant as the
    /// desktop's restart_sidecar).
    pub sidecar: Mutex<sidecar::Sidecar>,
    /// Reverse-proxy client (no proxy env — the sidecar is loopback).
    pub client: reqwest::Client,
}

impl AppState {
    pub fn new(
        ctx: ShellCtx,
        access_token: String,
        bootstrap_nonce: Option<String>,
        opencode_bin: PathBuf,
    ) -> Self {
        Self {
            ctx,
            access_token,
            session_token: shell_core::util::random_hex(32),
            bootstrap_nonce: Mutex::new(bootstrap_nonce),
            opencode_bin,
            sidecar: Mutex::new(sidecar::Sidecar::default()),
            client: reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("http client"),
        }
    }

    /// Start the sidecar if not running; returns its loopback base URL.
    pub async fn start_sidecar(&self) -> Result<String, String> {
        let mut s = self.sidecar.lock().await;
        s.ensure_started(&self.ctx, &self.opencode_bin)
    }

    /// Kill + respawn on the stable port (config changes only apply at spawn).
    pub async fn restart_sidecar(&self) -> Result<String, String> {
        let mut s = self.sidecar.lock().await;
        s.restart(&self.ctx, &self.opencode_bin)
    }

    /// The sidecar base URL, or an error when it never started.
    pub async fn sidecar_url(&self) -> Result<String, String> {
        let s = self.sidecar.lock().await;
        s.url()
            .ok_or_else(|| "agent runtime is not running".to_string())
    }

    pub async fn kill_sidecar(&self) {
        let mut s = self.sidecar.lock().await;
        s.kill();
    }
}
