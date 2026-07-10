// Everything needed to run the bundled OpenCode sidecar in an app-private
// profile — skill deployment, proxy resolution, config edits, workspace
// switching, and the sidecar's spawn recipe. The actual process spawn stays in
// the host (Tauri's shell plugin on desktop, tokio on the server): this module
// produces a `SidecarSpec` both consume, so the two runtimes stay identical.
use std::path::{Path, PathBuf};

use crate::ctx::{base_workspace_dir, workspace_dir, ShellCtx};
use crate::opencode_config::merge_config;
use crate::util::{enriched_path, quiet_command, random_hex, server_password, tighten_private};

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

/// Copy the user's OpenCode CLI login into the app-private data dir, EXPLICITLY
/// (from the Settings page) — never silently. Returns false when there is no
/// CLI login to import. The caller restarts the sidecar so it picks the
/// credentials up.
pub fn import_opencode_login(ctx: &ShellCtx) -> Result<bool, String> {
    let Some(src) = user_auth_source() else {
        return Ok(false);
    };
    let dst = ctx.runtime_root().join("xdg-data").join("opencode").join("auth.json");
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dst).map_err(|e| format!("copy failed: {e}"))?;
    Ok(true)
}

/// Deploy the bundled skill packs (host resources) into the app-private
/// profile's global skills dir (`<xdg-config>/opencode/skills/`), which OpenCode
/// scans regardless of project detection: `skills/` is the external ai4s-skills
/// pack, `skills-office/` Anthropic's document skills (docx/pdf/pptx/xlsx),
/// `skills-core/` the first-party skills from `runtime/skills/core`. The
/// workspace's own `.opencode/skills/` stays reserved for skills the user
/// installs. Runs before every sidecar start so app upgrades refresh the packs.
fn deploy_bundled_skills(ctx: &ShellCtx) {
    let dst = ctx.xdg_config_home().join("opencode").join("skills");
    let mut bundled: std::collections::HashSet<std::ffi::OsString> = std::collections::HashSet::new();
    let mut all_ok = true;
    for resource in ["skills", "skills-office", "skills-core"] {
        let src = match ctx.resource(resource) {
            Some(p) if p.is_dir() => p,
            _ => {
                all_ok = false; // dev run without `fetch-skills.sh` — nothing to deploy
                continue;
            }
        };
        match sync_skill_pack(&src, &dst) {
            Ok(names) => bundled.extend(names),
            Err(e) => {
                all_ok = false;
                eprintln!("failed to deploy bundled skills ({resource}): {e}");
            }
        }
    }
    // The global skills dir is exclusively app-managed (the user's own skills
    // live in the workspace's `.opencode/skills/`), so any skill dir not in the
    // freshly-bundled set is a stale leftover — e.g. one renamed across an app
    // upgrade (`hpc-slurm` → `remote-compute`) — and must be removed so the
    // obsolete duplicate can't shadow or confuse the agent. Prune ONLY when all
    // three packs deployed cleanly: a partial deploy would make `bundled`
    // incomplete and wrongly delete valid skills.
    if all_ok {
        prune_stale_skills(&dst, &bundled);
    }
}

/// Remove every SKILL.md-bearing directory in `dst` whose name is not in
/// `bundled` (the set just deployed). Non-skill directories are left untouched.
fn prune_stale_skills(dst: &Path, bundled: &std::collections::HashSet<std::ffi::OsString>) {
    let Ok(entries) = std::fs::read_dir(dst) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir()
            && path.join("SKILL.md").is_file()
            && !bundled.contains(&entry.file_name())
        {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

/// Copy every skill directory under `src` into `dst`, replacing same-named
/// directories (so bundled updates win) and leaving everything else in `dst`
/// alone. Returns the names of the skill directories it deployed (for stale
/// pruning). Directories without a SKILL.md (placeholders) are skipped.
fn sync_skill_pack(src: &Path, dst: &Path) -> std::io::Result<Vec<std::ffi::OsString>> {
    std::fs::create_dir_all(dst)?;
    let mut deployed = Vec::new();
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() || !entry.path().join("SKILL.md").is_file() {
            continue;
        }
        let target = dst.join(entry.file_name());
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        crate::util::copy_dir(&entry.path(), &target)?;
        deployed.push(entry.file_name());
    }
    Ok(deployed)
}

/// The persisted proxy setting as (mode, url). Unknown/missing → system.
fn read_proxy_setting(ctx: &ShellCtx) -> (String, String) {
    let raw = std::fs::read_to_string(ctx.proxy_setting_file()).unwrap_or_default();
    let line = raw.lines().next().unwrap_or("").trim();
    match line.split_once(' ') {
        Some(("custom", url)) if !url.trim().is_empty() => ("custom".into(), url.trim().into()),
        _ if line == "none" => ("none".into(), String::new()),
        _ => ("system".into(), String::new()),
    }
}

/// Accept `http://`, `https://` or `socks5://` with a host:port.
fn validate_proxy_url(url: &str) -> Result<(), String> {
    let rest = ["http://", "https://", "socks5://"]
        .iter()
        .find_map(|s| url.strip_prefix(s))
        .ok_or("proxy URL must start with http://, https:// or socks5://")?;
    let hostport = rest.trim_end_matches('/');
    let (host, port) = hostport
        .rsplit_once(':')
        .ok_or("proxy URL needs a host:port")?;
    if host.is_empty() || port.parse::<u16>().is_err() {
        return Err("proxy URL needs a host:port".into());
    }
    Ok(())
}

/// Proxy env for the sidecar. A GUI app launched from Finder/Dock inherits no
/// shell environment, so a user whose traffic runs through a system proxy
/// (common where provider hosts are unreachable directly) gets a sidecar that
/// cannot reach them: its fetch honors HTTP(S)_PROXY but nothing sets it.
/// Resolved from the persisted setting: `system` mirrors the OS proxy (an
/// existing env always wins — a terminal launch already carries the user's own
/// values), `custom` pins the user's URL, `none` neutralizes even inherited
/// env. Verified live with xAI OAuth (#9): the proxied browser delivers the
/// code, then the sidecar's token exchange to auth.x.ai hangs without a proxy
/// and succeeds with one.
fn resolve_proxy_env(mode: &str, url: &str) -> Vec<(&'static str, String)> {
    // Loopback traffic (the sidecar's own API, provider OAuth callback
    // servers) must never route through a proxy.
    const NO_PROXY_LOOPBACK: &str = "localhost,127.0.0.1,::1";
    match mode {
        "none" => vec![
            ("HTTP_PROXY", String::new()),
            ("HTTPS_PROXY", String::new()),
            ("http_proxy", String::new()),
            ("https_proxy", String::new()),
            ("ALL_PROXY", String::new()),
            ("NO_PROXY", "*".to_string()),
        ],
        "custom" => vec![
            ("HTTP_PROXY", url.to_string()),
            ("HTTPS_PROXY", url.to_string()),
            ("NO_PROXY", NO_PROXY_LOOPBACK.to_string()),
        ],
        _ => {
            if ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
                .iter()
                .any(|k| std::env::var_os(k).is_some())
            {
                return Vec::new();
            }
            match system_proxy_url() {
                Some(sys) => vec![
                    ("HTTP_PROXY", sys.clone()),
                    ("HTTPS_PROXY", sys),
                    ("NO_PROXY", NO_PROXY_LOOPBACK.to_string()),
                ],
                None => Vec::new(),
            }
        }
    }
}

/// The proxy the sidecar would actually use right now, for display in
/// Settings. None ⇒ direct connections.
fn effective_proxy(mode: &str, url: &str) -> Option<String> {
    match mode {
        "none" => None,
        "custom" => Some(url.to_string()),
        _ => ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
            .iter()
            .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
            .or_else(system_proxy_url),
    }
}

/// The system-configured proxy as a URL, if one is enabled (macOS: scutil).
/// HTTP(S) proxies are preferred — an HTTPS proxy endpoint still speaks plain
/// HTTP CONNECT, hence the http:// scheme — with SOCKS as the fallback.
#[cfg(target_os = "macos")]
fn system_proxy_url() -> Option<String> {
    let out = quiet_command("scutil").arg("--proxy").output().ok()?;
    parse_scutil_proxy(&String::from_utf8_lossy(&out.stdout))
}

/// Parse `scutil --proxy` output (`  Key : value` lines) into a proxy URL.
#[cfg(any(target_os = "macos", test))]
fn parse_scutil_proxy(text: &str) -> Option<String> {
    let get = |key: &str| -> Option<String> {
        let prefix = format!("{key} : ");
        text.lines()
            .find_map(|l| l.trim().strip_prefix(prefix.as_str()).map(|v| v.trim().to_string()))
    };
    let enabled = |key: &str| get(key).as_deref() == Some("1");
    for (en, host, port, scheme) in [
        ("HTTPSEnable", "HTTPSProxy", "HTTPSPort", "http"),
        ("HTTPEnable", "HTTPProxy", "HTTPPort", "http"),
        ("SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks5"),
    ] {
        if enabled(en) {
            if let (Some(h), Some(p)) = (get(host), get(port)) {
                return Some(format!("{scheme}://{h}:{p}"));
            }
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn system_proxy_url() -> Option<String> {
    // Windows/Linux: terminal-launched apps inherit the user's proxy env
    // (covered by the passthrough above); no OS store is read here yet.
    None
}

/// The recipe for one sidecar spawn: `opencode serve` arguments, environment,
/// and working directory. Building it prepares the app-private profile on disk
/// (XDG dirs, bundled skills, the seeded "approve" permission default, secret
/// permissions) — the host only has to launch its bundled `opencode` binary.
pub struct SidecarSpec {
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
    pub cwd: PathBuf,
}

pub fn build_sidecar_spec(ctx: &ShellCtx, port: u16) -> Result<SidecarSpec, String> {
    let root = ctx.runtime_root();
    let cfg = root.join("xdg-config");
    let data = root.join("xdg-data");
    let cache = root.join("xdg-cache");
    let state = root.join("xdg-state");
    // Run OpenCode inside the user-facing workspace, NOT the app's cwd (which is `/`
    // when launched from Finder) — otherwise it scans the whole filesystem root.
    let workspace = workspace_dir(ctx)?;
    for d in [&cfg, &data, &cache, &state] {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    // Ship the bundled scientific skills into the app-private OpenCode profile.
    deploy_bundled_skills(ctx);
    // Safety default (AGENTS.md non-negotiable): on first run, seed the
    // "approve" permission mode so dangerous shell commands prompt for
    // approval. A mode the user chose (approve or full) is never overridden.
    let cfg_file = ctx.effective_config_file();
    let existing = std::fs::read_to_string(&cfg_file).unwrap_or_default();
    if let Some(seeded) = crate::opencode_config::seed_default_permission(&existing) {
        if let Some(dir) = cfg_file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&cfg_file, seeded).map_err(|e| e.to_string())?;
    }
    // Secrets live under the runtime root (provider/connector keys in
    // opencode.jsonc, OpenCode's auth.json) — owner-only on every start, so
    // existing installs are repaired and whatever the sidecar later rewrites
    // inside stays unreachable to other users regardless of its umask.
    tighten_private(&root);
    tighten_private(&cfg_file);
    let home = std::env::var("HOME").unwrap_or_default();

    let mut envs: Vec<(String, String)> = vec![
        // Require auth on every request (P0-7): without a password the server
        // trusts ANY localhost-origin page (verified in the 1.17.13 source —
        // its CORS allowlist admits http://localhost:*/127.0.0.1:* wholesale,
        // and `--cors "*"` was only ever an exact-match literal, not a
        // wildcard). The host's client authenticates; nothing else may.
        ("OPENCODE_SERVER_PASSWORD".into(), server_password().to_string()),
        // App-private dirs: OpenCode never touches the user's ~/.config/opencode.
        ("XDG_CONFIG_HOME".into(), cfg.to_string_lossy().to_string()),
        ("XDG_DATA_HOME".into(), data.to_string_lossy().to_string()),
        ("XDG_CACHE_HOME".into(), cache.to_string_lossy().to_string()),
        ("XDG_STATE_HOME".into(), state.to_string_lossy().to_string()),
        ("HOME".into(), home),
        // Lets bundled skill helpers (e.g. remote-compute's record_run.py) stamp
        // the recording app version into provenance — they run outside the app
        // and can't otherwise know it.
        ("OPENSCIENCE_APP_VERSION".into(), ctx.app_version.clone()),
        // GUI-launched apps get a minimal PATH; give the agent the user's real tools.
        ("PATH".into(), enriched_path()),
    ];
    // Apply the network-proxy setting so provider logins and API calls work
    // where direct connections are blocked (see resolve_proxy_env).
    let (proxy_mode, proxy_url) = read_proxy_setting(ctx);
    for (k, v) in resolve_proxy_env(&proxy_mode, &proxy_url) {
        envs.push((k.to_string(), v));
    }

    Ok(SidecarSpec {
        args: vec![
            "serve".into(),
            "--hostname".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
        ],
        envs,
        cwd: workspace,
    })
}

/// Choose the base folder (Settings → Workspace → Change). Creates it if
/// needed and persists the choice; every NEW session's dated folder is created
/// under it. Existing sessions keep their folders.
pub fn set_workspace_base(ctx: &ShellCtx, path: &str) -> Result<String, String> {
    let dir = PathBuf::from(path);
    if !dir.is_absolute() {
        return Err("workspace base must be absolute".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create folder: {e}"))?;
    let canon = dir.canonicalize().map_err(|e| e.to_string())?;
    let file = ctx.base_workspace_file();
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(file, canon.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    Ok(canon.to_string_lossy().to_string())
}

/// Switch the active workspace folder: create it if needed and persist the
/// choice. The kernel / Files / provenance read the folder via `workspace_dir`;
/// the agent runtime is scoped per request — the frontend reconnects its event
/// stream with `?directory=` and creates sessions with it (a bare `/event`
/// stream would not see other folders' instances, so the scoped stream is
/// required). `path` must be absolute. No sidecar restart: OpenCode serves
/// every folder from one process via per-directory instances.
pub fn set_workspace(ctx: &ShellCtx, path: &str) -> Result<String, String> {
    let dir = PathBuf::from(path);
    if !dir.is_absolute() {
        return Err("workspace path must be absolute".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create folder: {e}"))?;
    let canon = dir.canonicalize().map_err(|e| e.to_string())?;
    let file = ctx.active_workspace_file();
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(file, canon.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    Ok(canon.to_string_lossy().to_string())
}

/// Create a new dated folder `<base>/<name>` and switch to it. `name` is a
/// single path segment (the frontend supplies a timestamp); rejects separators.
/// Seeds the agent harness into the fresh folder so it starts with its
/// operating rules, and takes the initial git snapshot.
pub fn new_dated_workspace(ctx: &ShellCtx, name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid folder name".into());
    }
    let dir = base_workspace_dir(ctx)?.join(name);
    let canon = set_workspace(ctx, &dir.to_string_lossy())?;
    // Only NEW dated folders get seeded (never `set_workspace` alone — switching
    // to an existing session must not re-plant the scaffold).
    crate::assets::seed_harness(ctx, Path::new(&canon));
    crate::git_snapshot::commit_best_effort(Path::new(&canon), "Initialize workspace");
    Ok(canon)
}

/// Record which session owns the active workspace, so bundled skill helpers
/// (record_run.py) can stamp remote runs with their `sessionId` — the app knows
/// the id but the off-app helper only sees the workspace. Written as
/// `<workspace>/.openscience/session.txt`; best-effort, empty ids are ignored.
pub fn mark_session(ctx: &ShellCtx, session_id: &str) -> Result<(), String> {
    let id = session_id.trim();
    if id.is_empty() {
        return Ok(());
    }
    let dir = workspace_dir(ctx)?.join(".openscience");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("session.txt");
    // Write-then-rename so a concurrent read never sees a half-written id.
    let tmp = path.with_extension("txt.tmp");
    std::fs::write(&tmp, id).map_err(|e| e.to_string())?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::write(&path, id);
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

/// Remove an entry from a map section of the app-private global OpenCode
/// config ("provider" or "mcp"). The caller restarts the sidecar (PATCH
/// /global/config cannot delete keys).
pub fn remove_config_entry(ctx: &ShellCtx, section: &str, key: &str) -> Result<(), String> {
    if !matches!(section, "provider" | "mcp") {
        return Err(format!("section \"{section}\" is not removable"));
    }
    let dir = ctx.xdg_config_home().join("opencode");
    // The server writes opencode.jsonc; older configs may be opencode.json.
    let path = ["opencode.jsonc", "opencode.json"]
        .iter()
        .map(|n| dir.join(n))
        .find(|p| p.exists())
        .ok_or("no global OpenCode config found")?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let out = remove_key_from_config(&text, section, key)?;
    std::fs::write(&path, out).map_err(|e| e.to_string())?;
    tighten_private(&path);
    Ok(())
}

/// Drop `key` from the config JSON's `section` map, erroring when the config
/// is not plain JSON or the key is absent.
fn remove_key_from_config(text: &str, section: &str, key: &str) -> Result<String, String> {
    let mut cfg: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("config is not plain JSON: {e}"))?;
    let removed = cfg
        .get_mut(section)
        .and_then(|p| p.as_object_mut())
        .map(|p| p.remove(key).is_some())
        .unwrap_or(false);
    if !removed {
        return Err(format!("\"{key}\" is not in the config's {section} section"));
    }
    serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())
}

/// The current approval mode ("approve" | "full"). Spawn seeding guarantees a
/// mode exists once the runtime has started; before that, report the default.
pub fn get_approval_mode(ctx: &ShellCtx) -> Result<String, String> {
    let existing = std::fs::read_to_string(ctx.effective_config_file()).unwrap_or_default();
    Ok(crate::opencode_config::permission_mode_of(&existing)
        .unwrap_or(crate::opencode_config::MODE_APPROVE)
        .to_string())
}

/// Switch the approval mode. The caller restarts the sidecar so the permission
/// rules take effect. Returns the config path written.
pub fn set_approval_mode(ctx: &ShellCtx, mode: &str) -> Result<PathBuf, String> {
    let path = ctx.effective_config_file();
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let updated = crate::opencode_config::set_permission_mode(&existing, mode)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, updated).map_err(|e| e.to_string())?;
    tighten_private(&path);
    Ok(path)
}

/// The persisted proxy setting plus the proxy the sidecar would use right now.
#[derive(serde::Serialize)]
pub struct ProxySetting {
    pub mode: String,
    pub url: String,
    /// The proxy the sidecar would use right now; None ⇒ direct.
    pub effective: Option<String>,
}

pub fn get_proxy_setting(ctx: &ShellCtx) -> ProxySetting {
    let (mode, url) = read_proxy_setting(ctx);
    let effective = effective_proxy(&mode, &url);
    ProxySetting { mode, url, effective }
}

/// Persist the proxy setting ("system" | "custom" | "none", url for custom).
/// The caller restarts the sidecar so its network env takes effect (the env
/// only applies at spawn). Returns the setting file written.
pub fn set_proxy_setting(ctx: &ShellCtx, mode: &str, url: &str) -> Result<PathBuf, String> {
    let line = match mode {
        "system" => "system".to_string(),
        "none" => "none".to_string(),
        "custom" => {
            let url = url.trim();
            validate_proxy_url(url)?;
            format!("custom {url}")
        }
        other => return Err(format!("unknown proxy mode: {other}")),
    };
    let path = ctx.proxy_setting_file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, line).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Write the provider key/model into the app-private OpenCode config. The
/// caller restarts the sidecar so it picks them up. Returns the config path.
pub fn configure_opencode(
    ctx: &ShellCtx,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<PathBuf, String> {
    let path = ctx.opencode_config_file();
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let merged = merge_config(&existing, provider, api_key, model, base_url)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, merged).map_err(|e| e.to_string())?;
    tighten_private(&path);
    Ok(path)
}

/// A fresh preview-server token (kept here so hosts share one shape).
pub fn preview_token() -> String {
    random_hex(16)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_scutil_proxy, prune_stale_skills, remove_key_from_config, resolve_proxy_env,
        sync_skill_pack, validate_proxy_url,
    };
    use std::fs;

    #[test]
    fn proxy_url_validation() {
        assert!(validate_proxy_url("http://127.0.0.1:7890").is_ok());
        assert!(validate_proxy_url("socks5://10.0.0.2:1080").is_ok());
        assert!(validate_proxy_url("http://[::1]:8080").is_ok());
        assert!(validate_proxy_url("127.0.0.1:7890").is_err()); // no scheme
        assert!(validate_proxy_url("http://host").is_err()); // no port
        assert!(validate_proxy_url("http://:7890").is_err()); // no host
        assert!(validate_proxy_url("ftp://h:1").is_err()); // wrong scheme
    }

    #[test]
    fn proxy_env_modes() {
        let none = resolve_proxy_env("none", "");
        assert!(none.iter().any(|(k, v)| *k == "NO_PROXY" && v == "*"));
        assert!(none.iter().any(|(k, v)| *k == "HTTPS_PROXY" && v.is_empty()));

        let custom = resolve_proxy_env("custom", "http://127.0.0.1:7890");
        assert!(custom.iter().any(|(k, v)| *k == "HTTPS_PROXY" && v == "http://127.0.0.1:7890"));
        assert!(custom.iter().any(|(k, v)| *k == "NO_PROXY" && v.contains("127.0.0.1")));
    }

    #[test]
    fn scutil_proxy_parses_and_prefers_https() {
        // Real `scutil --proxy` shape (indented `Key : value` lines).
        let all = "<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 1087\n  HTTPProxy : 127.0.0.1\n  HTTPSEnable : 1\n  HTTPSPort : 1087\n  HTTPSProxy : 127.0.0.1\n  SOCKSEnable : 1\n  SOCKSPort : 1087\n  SOCKSProxy : 127.0.0.1\n}";
        assert_eq!(parse_scutil_proxy(all).as_deref(), Some("http://127.0.0.1:1087"));
        let socks_only = "  SOCKSEnable : 1\n  SOCKSPort : 7890\n  SOCKSProxy : 10.0.0.2\n";
        assert_eq!(parse_scutil_proxy(socks_only).as_deref(), Some("socks5://10.0.0.2:7890"));
        let disabled = "  HTTPEnable : 0\n  HTTPPort : 1087\n  HTTPProxy : 127.0.0.1\n";
        assert_eq!(parse_scutil_proxy(disabled), None);
        assert_eq!(parse_scutil_proxy(""), None);
    }

    #[test]
    fn prune_removes_only_stale_skill_dirs() {
        let dst = std::env::temp_dir().join(format!("os-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dst);
        for name in ["remote-compute", "hpc-slurm"] {
            fs::create_dir_all(dst.join(name)).unwrap();
            fs::write(dst.join(name).join("SKILL.md"), b"---\n").unwrap();
        }
        // A directory without a SKILL.md must never be touched.
        fs::create_dir_all(dst.join("notes")).unwrap();

        let mut bundled = std::collections::HashSet::new();
        bundled.insert(std::ffi::OsString::from("remote-compute"));
        prune_stale_skills(&dst, &bundled);

        assert!(dst.join("remote-compute").is_dir(), "bundled skill kept");
        assert!(!dst.join("hpc-slurm").exists(), "stale renamed skill removed");
        assert!(dst.join("notes").is_dir(), "non-skill dir left alone");
        let _ = fs::remove_dir_all(&dst);
    }

    #[test]
    fn removes_only_the_named_config_entry() {
        let cfg = r#"{"model":"a/b","provider":{"ollama":{"npm":"x"},"keep":{"npm":"y"}},"mcp":{"pw":{"type":"local"}}}"#;
        let out = remove_key_from_config(cfg, "provider", "ollama").unwrap();
        assert!(!out.contains("ollama"));
        assert!(out.contains("keep"));
        assert!(out.contains("\"model\": \"a/b\""));
        let out2 = remove_key_from_config(cfg, "mcp", "pw").unwrap();
        assert!(!out2.contains("\"pw\""));
        // Absent key and non-JSON input are errors, not silent no-ops.
        assert!(remove_key_from_config(cfg, "provider", "missing").is_err());
        assert!(remove_key_from_config("// jsonc comment\n{}", "provider", "x").is_err());
    }

    fn write(path: &std::path::Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn sync_replaces_bundled_and_keeps_user_skills() {
        let tmp = std::env::temp_dir().join(format!("skillsync-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("src");
        let dst = tmp.join("dst");

        // Bundled pack: one skill with a nested reference file, plus a top-level
        // plain file (.commit) that must NOT be copied.
        write(&src.join("paper-writer/SKILL.md"), "v2");
        write(&src.join("paper-writer/references/guide.md"), "ref");
        write(&src.join(".commit"), "abc123");
        // A placeholder dir without SKILL.md must not be deployed.
        fs::create_dir_all(src.join("placeholder")).unwrap();

        // Existing workspace: a stale copy of the bundled skill (with a file the
        // new version no longer has) and a user-installed skill.
        write(&dst.join("paper-writer/SKILL.md"), "v1");
        write(&dst.join("paper-writer/obsolete.md"), "old");
        write(&dst.join("my-skill/SKILL.md"), "user");

        sync_skill_pack(&src, &dst).unwrap();

        assert_eq!(fs::read_to_string(dst.join("paper-writer/SKILL.md")).unwrap(), "v2");
        assert_eq!(
            fs::read_to_string(dst.join("paper-writer/references/guide.md")).unwrap(),
            "ref"
        );
        assert!(!dst.join("paper-writer/obsolete.md").exists(), "stale file must be gone");
        assert_eq!(fs::read_to_string(dst.join("my-skill/SKILL.md")).unwrap(), "user");
        assert!(!dst.join(".commit").exists(), "top-level files are not skills");
        assert!(!dst.join("placeholder").exists(), "dirs without SKILL.md are not skills");

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn sync_creates_destination_when_missing() {
        let tmp = std::env::temp_dir().join(format!("skillsync-new-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("src");
        write(&src.join("literature-survey/SKILL.md"), "s");

        let dst = tmp.join("deep/nested/skills");
        sync_skill_pack(&src, &dst).unwrap();
        assert_eq!(
            fs::read_to_string(dst.join("literature-survey/SKILL.md")).unwrap(),
            "s"
        );
        fs::remove_dir_all(&tmp).unwrap();
    }
}
