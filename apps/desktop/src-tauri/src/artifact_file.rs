// Read/open files the agent produced in the workspace, for artifact previews.
// Strictly sandboxed to the workspace root: a path that escapes it is rejected.
// The sandbox/read/list logic lives in shell_core::artifact (shared with the
// web server); this module keeps the Tauri wrappers plus the desktop-only
// pieces — native dialogs and opening paths/URLs with the OS.
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub use shell_core::artifact::resolve_under;
use shell_core::artifact::{self, ArtifactFile, DirEntry, NotebookEntry};

use crate::runtime::{ctx, workspace_dir};

/// The folder tree a file command operates in: the ACTIVE session workspace
/// (default) or the base folder every session workspace is created under.
pub fn scope_root(app: &AppHandle, root: Option<&str>) -> Result<PathBuf, String> {
    shell_core::ctx::scope_root(&ctx(app)?, root)
}

/// Resolve a file mentioned in an agent message to a real workspace-relative
/// path (searching by basename when the literal path does not exist), or None.
#[tauri::command]
pub fn resolve_artifact(app: AppHandle, path: String) -> Result<Option<String>, String> {
    Ok(artifact::locate_under(&workspace_dir(&app)?, &path))
}

/// Read a workspace file for preview. Text types come back as UTF-8, binary as
/// base64. `async`: previews read multi-MB files — never on the UI thread.
#[tauri::command(async)]
pub fn read_artifact(app: AppHandle, path: String, root: Option<String>) -> Result<ArtifactFile, String> {
    artifact::read_artifact(&scope_root(&app, root.as_deref())?, &path)
}

/// Open an absolute path with the OS default application / file manager.
/// Via the `opener` crate: on Windows that is ShellExecuteW — NEVER
/// `cmd /C start`, which re-parses `&`/`^`/`|` so an agent-emitted argument
/// could execute commands (and any legit path containing `&` broke). It also
/// reaps the helper process (the old spawn-and-forget leaked zombies).
pub fn os_open(full: &Path) -> Result<(), String> {
    opener::open(full).map_err(|e| format!("open failed: {e}"))
}

/// Open a workspace file in the OS default application.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String, root: Option<String>) -> Result<(), String> {
    let full = resolve_under(&scope_root(&app, root.as_deref())?, &path)?;
    os_open(&full)
}

/// Reveal a workspace file/dir in the OS file manager (Finder on macOS,
/// Explorer on Windows, the file-manager portal/DBus with a folder-open
/// fallback on Linux).
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String, root: Option<String>) -> Result<(), String> {
    let full = resolve_under(&scope_root(&app, root.as_deref())?, &path)?;
    reveal_impl(&full)
}

// Windows: opener's reveal uses SHOpenFolderAndSelectItems (COM), which can
// return a spurious IO error even when it would work. `explorer /select,<path>`
// is the reliable path — but explorer returns a NON-ZERO exit code even on
// success, so we spawn and don't wait; and it rejects the `\\?\` verbatim form
// that canonicalize() produces, so we pass the plain path. `raw_arg` keeps
// explorer's non-standard `/select,"…"` token intact (Rust must not re-quote).
#[cfg(target_os = "windows")]
fn reveal_impl(full: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let arg = format!("/select,\"{}\"", display_path(full));
    std::process::Command::new("explorer")
        .raw_arg(arg)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("reveal failed: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn reveal_impl(full: &Path) -> Result<(), String> {
    opener::reveal(full).map_err(|e| format!("reveal failed: {e}"))
}

/// The path in OS-native display form. On Windows, `canonicalize()` yields a
/// `\\?\` verbatim path that Explorer and most apps don't accept — strip it back
/// to the plain `C:\…` (and `\\server\share` for UNC). No-op elsewhere.
#[cfg(target_os = "windows")]
fn display_path(full: &Path) -> String {
    let s = full.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        s.into_owned()
    }
}

#[cfg(not(target_os = "windows"))]
fn display_path(full: &Path) -> String {
    full.to_string_lossy().into_owned()
}

/// The absolute filesystem path of a workspace file/dir, for "Copy path" — in
/// OS-native form (plain `C:\…` on Windows, not the `\\?\` verbatim path).
#[tauri::command]
pub fn absolute_path(app: AppHandle, path: String, root: Option<String>) -> Result<String, String> {
    let full = resolve_under(&scope_root(&app, root.as_deref())?, &path)?;
    Ok(display_path(&full))
}

/// All .ipynb files under the chosen root (same bounds/skips as the artifact
/// search), newest first. `root: "base"` spans every session folder.
#[tauri::command(async)]
pub fn list_notebooks(app: AppHandle, root: Option<String>) -> Result<Vec<NotebookEntry>, String> {
    artifact::list_notebooks(&scope_root(&app, root.as_deref())?)
}

/// List one directory under the chosen root (non-recursive) for the file
/// explorer. `rel` is a root-relative dir path ("" = the root itself). Hidden
/// entries and heavy build dirs are skipped; directories sort first, then by name.
#[tauri::command(async)]
pub fn list_dir(app: AppHandle, rel: String, root: Option<String>) -> Result<Vec<DirEntry>, String> {
    artifact::dir_entries(&scope_root(&app, root.as_deref())?, &rel)
}

/// Write text to a root-relative path (used to save notebooks). Rejects
/// absolute paths and any `..` component; missing parent dirs are created.
#[tauri::command]
pub fn write_workspace_file(
    app: AppHandle,
    path: String,
    content: String,
    root: Option<String>,
) -> Result<(), String> {
    artifact::write_workspace_file(&scope_root(&app, root.as_deref())?, &path, &content)
}

/// Pick local files via the native open dialog and copy them into the agent
/// workspace so the agent can read them. Returns workspace-relative names
/// (deduplicated as name-1.ext, name-2.ext on collision); empty on cancel.
#[tauri::command]
pub async fn add_files_to_workspace(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_files() else {
        return Ok(Vec::new()); // user cancelled
    };
    let ws = workspace_dir(&app)?;
    let mut added = Vec::new();
    for file in picked {
        let src = file.into_path().map_err(|e| e.to_string())?;
        let name = src
            .file_name()
            .ok_or("picked path has no file name")?
            .to_string_lossy()
            .to_string();
        let dst_name = artifact::unique_name(&ws, &name);
        std::fs::copy(&src, ws.join(&dst_name)).map_err(|e| format!("copy failed: {e}"))?;
        added.push(dst_name);
    }
    if !added.is_empty() {
        shell_core::git_snapshot::commit_best_effort(&ws, "Add workspace files");
    }
    Ok(added)
}

/// Write text content into the workspace under `filename` (deduplicated as
/// name-1.ext on collision). Used when a long paste becomes a file. Returns
/// the actual name written.
#[tauri::command]
pub fn add_text_to_workspace(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    artifact::add_text_to_workspace(&workspace_dir(&app)?, &filename, &content)
}

/// Open an http(s) URL in the user's default browser. The webview itself must
/// never navigate away from the app, so external links land here instead.
/// Same `opener` rationale as `os_open` — a URL like `https://x.com/?a=1&b=2`
/// used to execute `b=2` as a command on Windows via `cmd /C start`.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("only http(s) URLs can be opened".into());
    }
    opener::open(&url).map_err(|e| format!("open failed: {e}"))
}

/// Save text through a native "Save As" dialog. Returns the chosen path, or
/// None if the user cancelled. Async so the blocking dialog never runs on the
/// main thread.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(choice) = app.dialog().file().set_file_name(&filename).blocking_save_file() else {
        return Ok(None); // user cancelled
    };
    let path = choice.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| format!("write failed: {e}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::open_url;

    #[test]
    fn open_url_rejects_non_http_schemes() {
        // Only http(s) may leave the app — never file:, javascript:, or a bare
        // command. (The open itself goes through the `opener` crate, which on
        // Windows is ShellExecuteW — no `cmd /C start` re-parsing of `&`.)
        assert!(open_url("javascript:alert(1)".into()).is_err());
        assert!(open_url("file:///etc/hosts".into()).is_err());
        assert!(open_url("calc".into()).is_err());
    }
}
