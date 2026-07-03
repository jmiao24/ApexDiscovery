// Read/open files the agent produced in the workspace, for artifact previews.
// Strictly sandboxed to the workspace root: a path that escapes it is rejected.
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::runtime::workspace_dir;

#[derive(serde::Serialize)]
pub struct ArtifactFile {
    path: String,
    mime: String,
    encoding: &'static str, // "utf8" | "base64"
    data: String,
    size: u64,
}

pub fn mime_for(ext: &str) -> (&'static str, bool) {
    // (mime, is_text)
    match ext.to_ascii_lowercase().as_str() {
        "pdf" => ("application/pdf", false),
        "png" => ("image/png", false),
        "jpg" | "jpeg" => ("image/jpeg", false),
        "gif" => ("image/gif", false),
        "webp" => ("image/webp", false),
        "html" | "htm" => ("text/html", true),
        "svg" => ("image/svg+xml", true),
        "csv" => ("text/csv", true),
        "tsv" => ("text/tab-separated-values", true),
        "md" => ("text/markdown", true),
        "tex" => ("text/x-tex", true),
        "json" => ("application/json", true),
        "py" => ("text/x-python", true),
        "r" => ("text/x-r", true),
        "txt" => ("text/plain", true),
        "docx" => ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", false),
        "xlsx" => ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", false),
        "pptx" => ("application/vnd.openxmlformats-officedocument.presentationml.presentation", false),
        _ => ("application/octet-stream", false),
    }
}

/// Resolve `rel` under `root`, rejecting any path that escapes it.
pub fn resolve_under(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("root unavailable: {e}"))?;
    let joined = root.join(Path::new(rel));
    let full = joined
        .canonicalize()
        .map_err(|_| "file not found".to_string())?;
    if !full.starts_with(&root) {
        return Err("path escapes the workspace".into());
    }
    Ok(full)
}

fn resolve_in_workspace(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    resolve_under(&workspace_dir(app)?, rel)
}

// Bounds for the basename search so a huge workspace can't stall a resolve call.
const SEARCH_MAX_ENTRIES: usize = 10_000;
const SEARCH_MAX_DEPTH: usize = 8;

/// Locate `rel` under `root`: the literal path when it exists, otherwise the
/// workspace file with the same basename (newest mtime when several match).
/// Agent messages often name a file without its directory ("index.html" for
/// "canvas-project/index.html"), so a bare name must still resolve.
/// Returns a root-relative path with `/` separators, or None.
pub fn locate_under(root: &Path, rel: &str) -> Option<String> {
    if let Ok(p) = resolve_under(root, rel) {
        if p.is_file() {
            return Some(rel.trim_start_matches('/').to_string());
        }
    }
    let name = Path::new(rel).file_name()?.to_os_string();
    let root = root.canonicalize().ok()?;
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    let mut stack = vec![(root.clone(), 0usize)];
    let mut seen = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > SEARCH_MAX_ENTRIES {
                stack.clear();
                break;
            }
            let fname = entry.file_name();
            // Hidden files/dirs and dependency trees are never agent artifacts.
            let fname_str = fname.to_string_lossy();
            if fname_str.starts_with('.') || fname_str == "node_modules" || fname_str == "__pycache__" {
                continue;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                if depth < SEARCH_MAX_DEPTH {
                    stack.push((entry.path(), depth + 1));
                }
            } else if ft.is_file() && fname == name {
                let mtime = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                if best.as_ref().is_none_or(|(_, t)| mtime > *t) {
                    best = Some((entry.path(), mtime));
                }
            }
        }
    }
    let (path, _) = best?;
    let rel_path = path.strip_prefix(&root).ok()?;
    let parts: Vec<String> = rel_path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    Some(parts.join("/"))
}

/// Resolve a file mentioned in an agent message to a real workspace-relative
/// path (searching by basename when the literal path does not exist), or None.
#[tauri::command]
pub fn resolve_artifact(app: AppHandle, path: String) -> Result<Option<String>, String> {
    Ok(locate_under(&workspace_dir(&app)?, &path))
}

/// Read a workspace file for preview. Text types come back as UTF-8, binary as base64.
#[tauri::command]
pub fn read_artifact(app: AppHandle, path: String) -> Result<ArtifactFile, String> {
    let full = resolve_in_workspace(&app, &path)?;
    let ext = full
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let (mime, is_text) = mime_for(&ext);
    let bytes = std::fs::read(&full).map_err(|e| format!("read failed: {e}"))?;
    let size = bytes.len() as u64;
    // Cap previews so a huge file can't lock the UI.
    if size > 25 * 1024 * 1024 {
        return Err("file too large to preview (>25 MB)".into());
    }
    let (encoding, data) = if is_text {
        ("utf8", String::from_utf8_lossy(&bytes).into_owned())
    } else {
        ("base64", base64_encode(&bytes))
    };
    Ok(ArtifactFile { path, mime: mime.to_string(), encoding, data, size })
}

/// Open a workspace file in the OS default application.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let full = resolve_in_workspace(&app, &path)?;
    let full_s = full.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(full_s);
    cmd.spawn().map_err(|e| format!("open failed: {e}"))?;
    Ok(())
}

/// Minimal std-only base64 (avoids adding a dependency).
fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{base64_encode, locate_under};

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn locate_finds_literal_bare_and_missing_paths() {
        let root = std::env::temp_dir().join(format!("ai4s-locate-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("proj")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("root.pdf"), b"x").unwrap();
        std::fs::write(root.join("proj/index.html"), b"<h1>hi</h1>").unwrap();
        std::fs::write(root.join("node_modules/pkg/dep.html"), b"x").unwrap();

        // Literal path that exists is returned as-is.
        assert_eq!(locate_under(&root, "root.pdf").as_deref(), Some("root.pdf"));
        assert_eq!(
            locate_under(&root, "proj/index.html").as_deref(),
            Some("proj/index.html")
        );
        // A bare filename resolves to the real location in a subdirectory.
        assert_eq!(
            locate_under(&root, "index.html").as_deref(),
            Some("proj/index.html")
        );
        // Dependency trees are skipped; missing files and escapes resolve to None.
        assert_eq!(locate_under(&root, "dep.html"), None);
        assert_eq!(locate_under(&root, "missing.pdf"), None);
        assert_eq!(locate_under(&root, "../../etc/hosts"), None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn locate_prefers_the_newest_of_duplicate_basenames() {
        let root = std::env::temp_dir().join(format!("ai4s-locate-dup-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("old")).unwrap();
        std::fs::create_dir_all(root.join("new")).unwrap();
        std::fs::write(root.join("old/report.pdf"), b"x").unwrap();
        std::fs::write(root.join("new/report.pdf"), b"y").unwrap();
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        let f = std::fs::File::options().write(true).open(root.join("old/report.pdf")).unwrap();
        f.set_modified(past).unwrap();

        assert_eq!(
            locate_under(&root, "report.pdf").as_deref(),
            Some("new/report.pdf")
        );

        let _ = std::fs::remove_dir_all(root);
    }
}
