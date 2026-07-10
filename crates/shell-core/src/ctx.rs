// The host context: everything the shared commands need to know about where
// they run. The desktop builds it from Tauri's AppHandle; the web server from
// CLI flags/env. Cheap to construct — hosts may build one per command call.
use std::path::PathBuf;

#[derive(Clone)]
pub struct ShellCtx {
    /// App-private data dir (desktop: `app_data_dir()`; server: `--data-dir`).
    /// Holds the runtime root (sidecar XDG dirs, config, secrets) and debug.log.
    pub data_dir: PathBuf,
    /// The user's documents dir, for the default workspace base. None falls
    /// back to `$HOME/Documents`.
    pub document_dir: Option<PathBuf>,
    /// Dir holding bundled resources (`skills/`, `skills-office/`, `skills-core/`,
    /// `harness/`, `examples/`). None in bare dev runs — resource-dependent
    /// features degrade gracefully.
    pub resource_dir: Option<PathBuf>,
    /// App version stamped into provenance/env records.
    pub app_version: String,
}

impl ShellCtx {
    /// App-private runtime root, e.g. <data>/runtime.
    pub fn runtime_root(&self) -> PathBuf {
        self.data_dir.join("runtime")
    }

    pub fn xdg_config_home(&self) -> PathBuf {
        self.runtime_root().join("xdg-config")
    }

    /// File recording the user's chosen active workspace folder (absolute path).
    pub(crate) fn active_workspace_file(&self) -> PathBuf {
        self.runtime_root().join("active-workspace.txt")
    }

    /// File recording the user's chosen BASE folder — the parent every new dated
    /// session workspace is created under (Settings → Workspace).
    pub(crate) fn base_workspace_file(&self) -> PathBuf {
        self.runtime_root().join("base-workspace.txt")
    }

    /// Path OpenCode reads when XDG_CONFIG_HOME points at our private dir.
    pub(crate) fn opencode_config_file(&self) -> PathBuf {
        self.xdg_config_home().join("opencode").join("opencode.json")
    }

    /// The config file to edit in place: the server may have rewritten the config
    /// as opencode.jsonc — prefer whichever exists, fall back to opencode.json.
    pub(crate) fn effective_config_file(&self) -> PathBuf {
        let dir = self.xdg_config_home().join("opencode");
        ["opencode.jsonc", "opencode.json"]
            .iter()
            .map(|n| dir.join(n))
            .find(|p| p.exists())
            .unwrap_or_else(|| dir.join("opencode.json"))
    }

    pub(crate) fn proxy_setting_file(&self) -> PathBuf {
        self.runtime_root().join("proxy.txt")
    }

    /// A bundled resource path, when a resource dir is configured.
    pub fn resource(&self, rel: &str) -> Option<PathBuf> {
        self.resource_dir.as_ref().map(|d| d.join(rel))
    }
}

/// The active workspace folder OpenCode / previews / provenance all operate in.
/// Defaults to the base folder until the user opens or creates another one; the
/// choice persists across restarts.
pub fn workspace_dir(ctx: &ShellCtx) -> Result<PathBuf, String> {
    if let Ok(s) = std::fs::read_to_string(ctx.active_workspace_file()) {
        let dir = PathBuf::from(s.trim());
        if dir.is_dir() {
            return Ok(dir);
        }
    }
    base_workspace_dir(ctx)
}

/// The workspace root new dated session folders are created under. A folder
/// the user picked in Settings wins; the default is `~/Documents/OpenScience`
/// (no space — the agent runs shell commands against this path, and unquoted
/// spaces break them), falling back to `$HOME/Documents`.
pub fn base_workspace_dir(ctx: &ShellCtx) -> Result<PathBuf, String> {
    if let Ok(s) = std::fs::read_to_string(ctx.base_workspace_file()) {
        let dir = PathBuf::from(s.trim());
        if dir.is_dir() {
            return Ok(dir);
        }
    }
    let docs = match &ctx.document_dir {
        Some(d) => d.clone(),
        None => {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "could not resolve a documents directory".to_string())?;
            PathBuf::from(home).join("Documents")
        }
    };
    let dir = docs.join("OpenScience");

    // One-time migrations, oldest name last. A failed rename (e.g. cross-volume)
    // keeps the existing location rather than splitting the user's files.
    if !dir.exists() {
        for old in [docs.join("Open Science"), ctx.runtime_root().join("workspace")] {
            if old.is_dir() {
                if std::fs::rename(&old, &dir).is_ok() {
                    break;
                }
                return Ok(old);
            }
        }
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The folder tree a file command operates in: the ACTIVE session workspace
/// (default) or the base folder every session workspace is created under.
/// Pages declare their scope explicitly — no fallback guessing between the
/// two, so an identical relative path can never resolve ambiguously.
pub fn scope_root(ctx: &ShellCtx, root: Option<&str>) -> Result<PathBuf, String> {
    match root.unwrap_or("workspace") {
        "workspace" => workspace_dir(ctx),
        "base" => base_workspace_dir(ctx),
        other => Err(format!("unknown root scope: {other}")),
    }
}
