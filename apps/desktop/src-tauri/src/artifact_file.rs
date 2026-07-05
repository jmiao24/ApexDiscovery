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
        "ipynb" => ("application/x-ipynb+json", true),
        "yaml" | "yml" => ("text/yaml", true),
        "js" | "ts" | "sh" | "toml" | "log" => ("text/plain", true),
        "py" => ("text/x-python", true),
        "r" => ("text/x-r", true),
        // Molecular structure formats — all plain text, rendered in 3D by the
        // molecule viewer (3Dmol.js) which needs the raw utf8, not base64.
        "mol" | "sdf" => ("chemical/x-mdl-molfile", true),
        "mol2" => ("chemical/x-mol2", true),
        "smi" | "smiles" => ("chemical/x-daylight-smiles", true),
        "cif" | "mcif" | "mmcif" => ("chemical/x-cif", true),
        "pdb" => ("chemical/x-pdb", true),
        "pqr" => ("chemical/x-pqr", true),
        "xyz" => ("chemical/x-xyz", true),
        "cube" => ("chemical/x-cube", true),
        // Genome annotation tracks — plain text, rendered by the native track viewer.
        "bed" | "bedgraph" | "bdg" | "gff" | "gff3" | "gtf" | "vcf" => ("text/plain", true),
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

/// Open an absolute path with the OS default application / file manager.
pub fn os_open(full: &Path) -> Result<(), String> {
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

/// Open a workspace file in the OS default application.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let full = resolve_in_workspace(&app, &path)?;
    os_open(&full)
}

#[derive(serde::Serialize)]
pub struct NotebookEntry {
    path: String,
    /// Seconds since the epoch, for newest-first sorting in the UI.
    modified: u64,
}

/// All .ipynb files in the workspace (same bounds/skips as the artifact search),
/// newest first.
#[tauri::command]
pub fn list_notebooks(app: AppHandle) -> Result<Vec<NotebookEntry>, String> {
    let root = workspace_dir(&app)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut found = Vec::new();
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
            let fname_str = fname.to_string_lossy();
            if fname_str.starts_with('.') || fname_str == "node_modules" || fname_str == "__pycache__" {
                continue;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                if depth < SEARCH_MAX_DEPTH {
                    stack.push((entry.path(), depth + 1));
                }
            } else if ft.is_file() && fname_str.ends_with(".ipynb") {
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                if let Ok(rel) = entry.path().strip_prefix(&root) {
                    let parts: Vec<String> = rel
                        .components()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                        .collect();
                    found.push(NotebookEntry { path: parts.join("/"), modified });
                }
            }
        }
    }
    found.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(found)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// Workspace-relative path with `/` separators.
    path: String,
    /// Base name shown in the tree.
    name: String,
    is_dir: bool,
    /// File size in bytes (0 for directories).
    size: u64,
    /// Seconds since the epoch.
    modified: u64,
}

/// List one directory in the workspace (non-recursive) for the file explorer.
/// `rel` is a workspace-relative dir path ("" = workspace root). Hidden entries
/// and heavy build dirs are skipped; directories sort first, then by name.
#[tauri::command]
pub fn list_dir(app: AppHandle, rel: String) -> Result<Vec<DirEntry>, String> {
    dir_entries(&workspace_dir(&app)?, &rel)
}

fn dir_entries(root: &Path, rel: &str) -> Result<Vec<DirEntry>, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let dir = resolve_under(&root, rel)?;
    if !dir.is_dir() {
        return Err("not a directory".into());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let fname = entry.file_name();
        let name = fname.to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" || name == "__pycache__" {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let meta = entry.metadata().ok();
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let Ok(rel_path) = entry.path().strip_prefix(&root).map(|p| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        }) else {
            continue;
        };
        out.push(DirEntry {
            path: rel_path,
            name,
            is_dir: ft.is_dir(),
            size: if ft.is_file() { meta.as_ref().map(|m| m.len()).unwrap_or(0) } else { 0 },
            modified,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// Write text to a workspace-relative path (used to save notebooks). Rejects
/// absolute paths and any `..` component; missing parent dirs are created.
#[tauri::command]
pub fn write_workspace_file(app: AppHandle, path: String, content: String) -> Result<(), String> {
    let rel = Path::new(&path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("path must be a plain workspace-relative path".into());
    }
    let full = workspace_dir(&app)?.join(rel);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, content).map_err(|e| format!("write failed: {e}"))
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
        let dst_name = unique_name(&ws, &name);
        std::fs::copy(&src, ws.join(&dst_name)).map_err(|e| format!("copy failed: {e}"))?;
        added.push(dst_name);
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
    let base = Path::new(&filename)
        .file_name()
        .ok_or("invalid file name")?
        .to_string_lossy()
        .to_string();
    let ws = workspace_dir(&app)?;
    let name = unique_name(&ws, &base);
    std::fs::write(ws.join(&name), content).map_err(|e| format!("write failed: {e}"))?;
    Ok(name)
}

/// First free variant of `name` in `dir`: name.ext, name-1.ext, name-2.ext, …
fn unique_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e)),
        _ => (name, None),
    };
    for n in 1.. {
        let candidate = match ext {
            Some(e) => format!("{stem}-{n}.{e}"),
            None => format!("{stem}-{n}"),
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    unreachable!()
}

/// Open an http(s) URL in the user's default browser. The webview itself must
/// never navigate away from the app, so external links land here instead.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("only http(s) URLs can be opened".into());
    }
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
    cmd.arg(&url);
    cmd.spawn().map_err(|e| format!("open failed: {e}"))?;
    Ok(())
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
    use super::{base64_encode, dir_entries, locate_under, mime_for, unique_name};

    #[test]
    fn genome_and_molecule_files_are_text() {
        for ext in ["bed", "bedgraph", "gff", "gff3", "gtf", "vcf"] {
            assert!(mime_for(ext).1, "{ext} must be a text type");
        }
    }

    #[test]
    fn list_dir_sorts_dirs_first_and_skips_hidden() {
        let root = std::env::temp_dir().join(format!("ai4s-listdir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join("b.txt"), "hi").unwrap();
        std::fs::write(root.join("a.csv"), "x,y").unwrap();
        std::fs::write(root.join("node_modules_marker"), "").unwrap();
        std::fs::create_dir_all(root.join("node_modules")).unwrap();

        let entries = dir_entries(&root, "").unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // dir first, then files alphabetically; hidden + node_modules skipped.
        assert_eq!(names, vec!["sub", "a.csv", "b.txt", "node_modules_marker"]);
        assert!(entries[0].is_dir);
        assert_eq!(entries.iter().find(|e| e.name == "a.csv").unwrap().size, 3);

        // Listing a subdirectory and rejecting escapes.
        assert!(dir_entries(&root, "sub").unwrap().is_empty());
        assert!(dir_entries(&root, "../..").is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn molecule_files_are_text() {
        // The 3D molecule viewer needs utf8, not base64 (3Dmol parses the source).
        for ext in [
            "mol", "mol2", "sdf", "smi", "smiles", "cif", "mcif", "mmcif", "pdb", "pqr", "xyz", "cube",
        ] {
            assert!(mime_for(ext).1, "{ext} must be a text type");
        }
    }

    #[test]
    fn unique_name_dedupes_with_numeric_suffix() {
        let dir = std::env::temp_dir().join(format!("ai4s-unique-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert_eq!(unique_name(&dir, "data.csv"), "data.csv");
        std::fs::write(dir.join("data.csv"), "x").unwrap();
        assert_eq!(unique_name(&dir, "data.csv"), "data-1.csv");
        std::fs::write(dir.join("data-1.csv"), "x").unwrap();
        assert_eq!(unique_name(&dir, "data.csv"), "data-2.csv");

        // No extension, and dotfiles (no stem before the dot) keep their whole name.
        std::fs::write(dir.join("README"), "x").unwrap();
        assert_eq!(unique_name(&dir, "README"), "README-1");
        std::fs::write(dir.join(".env"), "x").unwrap();
        assert_eq!(unique_name(&dir, ".env"), ".env-1");

        std::fs::remove_dir_all(&dir).unwrap();
    }

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
