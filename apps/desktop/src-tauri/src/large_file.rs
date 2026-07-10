// UI entry to the large-file memory-pointer probe (P0-6) — Tauri wrapper over
// shell_core::large_file. Locates the bundled probe script and the kernel's
// Python, then runs the bounded-memory probe.
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use shell_core::large_file::first_existing;

use crate::artifact_file::{resolve_under, scope_root};

/// Locate the probe script: the bundled Tauri resource first, then the in-repo
/// path for `pnpm tauri dev`.
fn probe_script(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve(
        "skills-core/large-file/large_file_probe.py",
        tauri::path::BaseDirectory::Resource,
    ) {
        candidates.push(p);
    }
    // Dev fallback: repo checkout relative to the crate.
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
        "../../../runtime/skills/core/large-file/large_file_probe.py",
    ));
    first_existing(&candidates)
}

/// Introspect a workspace file with the large-file probe and return the JSON
/// pointer string. `path` is resolved (and sandboxed) under the given scope.
/// `async`: the probe is a whole python run over a large file.
#[tauri::command(async)]
pub fn probe_large_file(
    app: AppHandle,
    path: String,
    root: Option<String>,
) -> Result<String, String> {
    let full = resolve_under(&scope_root(&app, root.as_deref())?, &path)?;
    let (python, _) = crate::kernel::python_bin(&app)?;
    let script = probe_script(&app).ok_or("large-file probe not found")?;
    shell_core::large_file::probe_large_file(&python, &script, &full)
}
