use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

const INDEX_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    skills: Option<String>,
    #[serde(default)]
    mcp_servers: Option<String>,
    #[serde(default)]
    hooks: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub source: String,
    pub enabled: bool,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub has_scripts: bool,
    pub has_hooks: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ExtensionIndex {
    version: u32,
    plugins: Vec<InstalledPlugin>,
}

impl Default for ExtensionIndex {
    fn default() -> Self {
        Self {
            version: INDEX_VERSION,
            plugins: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    /// Local plugin directory or an HTTPS Git URL.
    source: String,
    #[serde(default)]
    git_ref: Option<String>,
    /// Optional full commit id. Remote installs should pin this in catalogs.
    #[serde(default)]
    expected_commit: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EnableRequest {
    enabled: bool,
}

fn extensions_dir(state: &AppState) -> PathBuf {
    state.ctx.data_dir.join("extensions")
}

fn index_path(root: &Path) -> PathBuf {
    root.join("index.json")
}

fn load_index(root: &Path) -> Result<ExtensionIndex, String> {
    let path = index_path(root);
    if !path.exists() {
        return Ok(ExtensionIndex::default());
    }
    let bytes = fs::read(&path).map_err(|e| format!("could not read extension index: {e}"))?;
    let mut index: ExtensionIndex =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid extension index: {e}"))?;
    if index.version != INDEX_VERSION {
        return Err(format!(
            "unsupported extension index version {}",
            index.version
        ));
    }
    index
        .plugins
        .retain(|plugin| Path::new(&plugin.path).is_dir());
    Ok(index)
}

fn save_index(root: &Path, index: &ExtensionIndex) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("could not create extension directory: {e}"))?;
    let path = index_path(root);
    let tmp = root.join("index.json.tmp");
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| format!("could not write extension index: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("could not commit extension index: {e}"))
}

fn valid_plugin_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
}

fn safe_relative(root: &Path, value: &str) -> Result<PathBuf, String> {
    let rel = Path::new(value);
    if rel.is_absolute()
        || rel
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err(format!("plugin path must stay inside the package: {value}"));
    }
    Ok(root.join(rel))
}

fn read_manifest(root: &Path) -> Result<PluginManifest, String> {
    let path = root.join(".codex-plugin").join("plugin.json");
    let bytes =
        fs::read(&path).map_err(|_| "plugin is missing .codex-plugin/plugin.json".to_string())?;
    let manifest: PluginManifest =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid plugin manifest: {e}"))?;
    if !valid_plugin_name(&manifest.name) {
        return Err("plugin name must be lower-case kebab-case".to_string());
    }
    if manifest.version.trim().is_empty() || manifest.version.len() > 64 {
        return Err("plugin version is required".to_string());
    }
    for value in [
        manifest.skills.as_deref(),
        manifest.mcp_servers.as_deref(),
        manifest.hooks.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let path = safe_relative(root, value)?;
        if !path.exists() {
            return Err(format!("manifest component does not exist: {value}"));
        }
    }
    Ok(manifest)
}

fn directory_names(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter(|entry| entry.path().join("SKILL.md").is_file())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

fn mcp_names(path: &Path) -> Result<Vec<String>, String> {
    let bytes = fs::read(path).map_err(|e| format!("could not read MCP config: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid MCP config: {e}"))?;
    let object = value
        .get("mcpServers")
        .or_else(|| value.get("mcp_servers"))
        .unwrap_or(&value)
        .as_object()
        .ok_or_else(|| "MCP config must be an object".to_string())?;
    let mut names: Vec<String> = object.keys().cloned().collect();
    names.sort();
    Ok(names)
}

fn tree_has_dir(root: &Path, target: &str) -> bool {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let kind = match entry.file_type() {
            Ok(kind) => kind,
            Err(_) => continue,
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir()
            && (entry.file_name().to_string_lossy() == target || tree_has_dir(&path, target))
        {
            return true;
        }
    }
    false
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|e| format!("could not create plugin directory: {e}"))?;
    for entry in
        fs::read_dir(source).map_err(|e| format!("could not read plugin directory: {e}"))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err(format!(
                "plugin packages may not contain symlinks: {}",
                entry.path().display()
            ));
        }
        let destination_path = destination.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &destination_path)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), destination_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn resolve_source(
    root: &Path,
    request: &InstallRequest,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let source = request.source.trim();
    if source.starts_with("https://") {
        if source.len() > 2048
            || source.split_once("://").is_some_and(|(_, rest)| {
                rest.split('/')
                    .next()
                    .is_some_and(|host| host.contains('@'))
            })
        {
            return Err("plugin Git URL must not contain credentials".to_string());
        }
        if let Some(git_ref) = request.git_ref.as_deref() {
            if git_ref.is_empty()
                || git_ref.len() > 200
                || !git_ref
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._/-".contains(&byte))
            {
                return Err("invalid Git ref".to_string());
            }
        }
        if let Some(expected) = request.expected_commit.as_deref() {
            if !matches!(expected.len(), 40 | 64)
                || !expected.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err("expectedCommit must be a full hexadecimal commit id".to_string());
            }
        }
        let staging = root.join(format!(
            ".download-{}-{}",
            std::process::id(),
            shell_core::util::random_hex(4)
        ));
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
        }
        let mut command = Command::new("git");
        command.args(["clone", "--depth", "1", "--no-tags"]);
        if let Some(git_ref) = request
            .git_ref
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.args(["--branch", git_ref]);
        }
        let status = command
            .arg(source)
            .arg(&staging)
            .status()
            .map_err(|e| format!("could not start git: {e}"))?;
        if !status.success() {
            let _ = fs::remove_dir_all(&staging);
            return Err("git clone failed".to_string());
        }
        if let Some(expected) = request.expected_commit.as_deref() {
            let output = Command::new("git")
                .args([
                    "-C",
                    staging.to_string_lossy().as_ref(),
                    "rev-parse",
                    "HEAD",
                ])
                .output()
                .map_err(|e| e.to_string())?;
            let actual = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !output.status.success() || !actual.eq_ignore_ascii_case(expected.trim()) {
                let _ = fs::remove_dir_all(&staging);
                return Err(format!(
                    "plugin commit mismatch: expected {}, got {actual}",
                    expected.trim()
                ));
            }
        }
        return Ok((staging.clone(), Some(staging)));
    }

    let path =
        fs::canonicalize(source).map_err(|e| format!("plugin source is not readable: {e}"))?;
    if !path.is_dir() {
        return Err("plugin source must be a directory or HTTPS Git URL".to_string());
    }
    let storage = fs::canonicalize(root).map_err(|e| e.to_string())?;
    if path.starts_with(&storage) || storage.starts_with(&path) {
        return Err(
            "plugin source must not overlap the app's extension storage directory".to_string(),
        );
    }
    Ok((path, None))
}

fn install(root: &Path, request: &InstallRequest) -> Result<InstalledPlugin, String> {
    fs::create_dir_all(root.join("plugins")).map_err(|e| e.to_string())?;
    let (source_root, cleanup) = resolve_source(root, request)?;
    let result: Result<InstalledPlugin, String> = (|| {
        let manifest = read_manifest(&source_root)?;
        let skills_root = manifest
            .skills
            .as_deref()
            .map(|path| safe_relative(&source_root, path))
            .transpose()?
            .unwrap_or_else(|| source_root.join("skills"));
        let skills = directory_names(&skills_root);
        let mcp_servers = manifest
            .mcp_servers
            .as_deref()
            .map(|path| safe_relative(&source_root, path).and_then(|path| mcp_names(&path)))
            .transpose()?
            .unwrap_or_default();

        let destination = root.join("plugins").join(&manifest.name);
        let staged = root
            .join("plugins")
            .join(format!(".{}-staging", manifest.name));
        if staged.exists() {
            fs::remove_dir_all(&staged).map_err(|e| e.to_string())?;
        }
        copy_tree(&source_root, &staged)?;
        // An update is disabled by default so newly added tools/scripts require
        // a fresh user review before they can run.
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|e| e.to_string())?;
        }
        fs::rename(&staged, &destination).map_err(|e| e.to_string())?;

        Ok(InstalledPlugin {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            path: destination.to_string_lossy().to_string(),
            source: request.source.clone(),
            enabled: false,
            skills,
            mcp_servers,
            has_scripts: tree_has_dir(&destination, "scripts"),
            has_hooks: manifest.hooks.is_some(),
        })
    })();
    if let Some(path) = cleanup {
        let _ = fs::remove_dir_all(path);
    }
    let plugin = result?;
    let mut index = load_index(root)?;
    index.plugins.retain(|item| item.name != plugin.name);
    index.plugins.push(plugin.clone());
    index.plugins.sort_by(|a, b| a.name.cmp(&b.name));
    save_index(root, &index)?;
    Ok(plugin)
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(serde_json::json!({ "error": message.into() }))).into_response()
}

pub async fn list_extensions(State(state): State<Arc<AppState>>) -> Response {
    match load_index(&extensions_dir(&state)) {
        Ok(index) => Json(index.plugins).into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn install_extension(
    State(state): State<Arc<AppState>>,
    Json(request): Json<InstallRequest>,
) -> Response {
    let root = extensions_dir(&state);
    match tokio::task::spawn_blocking(move || install(&root, &request)).await {
        Ok(Ok(plugin)) => (StatusCode::CREATED, Json(plugin)).into_response(),
        Ok(Err(message)) => error(StatusCode::BAD_REQUEST, message),
        Err(join_error) => error(StatusCode::INTERNAL_SERVER_ERROR, join_error.to_string()),
    }
}

pub async fn set_extension_enabled(
    State(state): State<Arc<AppState>>,
    AxumPath(name): AxumPath<String>,
    Json(request): Json<EnableRequest>,
) -> Response {
    let root = extensions_dir(&state);
    let mut index = match load_index(&root) {
        Ok(index) => index,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, message),
    };
    let Some(plugin) = index.plugins.iter_mut().find(|plugin| plugin.name == name) else {
        return error(StatusCode::NOT_FOUND, "plugin not found");
    };
    plugin.enabled = request.enabled;
    let result = plugin.clone();
    match save_index(&root, &index) {
        Ok(()) => Json(result).into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

pub async fn remove_extension(
    State(state): State<Arc<AppState>>,
    AxumPath(name): AxumPath<String>,
) -> Response {
    let root = extensions_dir(&state);
    let mut index = match load_index(&root) {
        Ok(index) => index,
        Err(message) => return error(StatusCode::INTERNAL_SERVER_ERROR, message),
    };
    let Some(position) = index.plugins.iter().position(|plugin| plugin.name == name) else {
        return error(StatusCode::NOT_FOUND, "plugin not found");
    };
    let plugin = index.plugins.remove(position);
    let plugin_path = PathBuf::from(&plugin.path);
    let canonical_root = fs::canonicalize(root.join("plugins")).ok();
    let canonical_plugin = fs::canonicalize(&plugin_path).ok();
    if canonical_root
        .zip(canonical_plugin)
        .is_some_and(|(root, plugin)| plugin.starts_with(root))
    {
        if let Err(e) = fs::remove_dir_all(&plugin_path) {
            return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }
    match save_index(&root, &index) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "apex-extension-{label}-{}-{}",
            std::process::id(),
            shell_core::util::random_hex(4)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn fixture(root: &Path, name: &str) -> PathBuf {
        let plugin = root.join("source");
        fs::create_dir_all(plugin.join(".codex-plugin")).unwrap();
        fs::create_dir_all(plugin.join("skills").join("search").join("scripts")).unwrap();
        fs::write(
            plugin.join(".codex-plugin").join("plugin.json"),
            format!(r#"{{"name":"{name}","version":"1.0.0","description":"Test","skills":"./skills","mcpServers":"./.mcp.json"}}"#),
        )
        .unwrap();
        fs::write(
            plugin.join("skills/search/SKILL.md"),
            "---\nname: search\ndescription: Search\n---\n",
        )
        .unwrap();
        fs::write(
            plugin.join(".mcp.json"),
            r#"{"mcpServers":{"papers":{"url":"https://example.test/mcp"}}}"#,
        )
        .unwrap();
        plugin
    }

    #[test]
    fn installs_disabled_and_indexes_capabilities() {
        let root = temp_root("install");
        let source = fixture(&root, "paper-tools");
        let plugin = install(
            &root.join("extensions"),
            &InstallRequest {
                source: source.to_string_lossy().to_string(),
                git_ref: None,
                expected_commit: None,
            },
        )
        .unwrap();
        assert!(!plugin.enabled);
        assert_eq!(plugin.skills, ["search"]);
        assert_eq!(plugin.mcp_servers, ["papers"]);
        assert!(plugin.has_scripts);
        assert!(Path::new(&plugin.path)
            .join(".codex-plugin/plugin.json")
            .is_file());
        assert_eq!(
            load_index(&root.join("extensions")).unwrap().plugins.len(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_manifest_paths_that_escape_the_package() {
        let root = temp_root("escape");
        let source = fixture(&root, "unsafe");
        fs::write(
            source.join(".codex-plugin/plugin.json"),
            r#"{"name":"unsafe","version":"1.0.0","skills":"../outside"}"#,
        )
        .unwrap();
        let error = install(
            &root.join("extensions"),
            &InstallRequest {
                source: source.to_string_lossy().to_string(),
                git_ref: None,
                expected_commit: None,
            },
        )
        .unwrap_err();
        assert!(error.contains("stay inside"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_local_source_that_contains_extension_storage() {
        let root = temp_root("overlap");
        let source = fixture(&root, "recursive-copy");
        let error = install(
            &source.join("extensions"),
            &InstallRequest {
                source: source.to_string_lossy().to_string(),
                git_ref: None,
                expected_commit: None,
            },
        )
        .unwrap_err();
        assert!(error.contains("must not overlap"));
        fs::remove_dir_all(root).unwrap();
    }
}
