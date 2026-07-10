// Bundled workspace assets: the agent harness scaffold seeded into every new
// dated session folder, and the built-in example projects — both shipped in the
// host's resource dir (`harness/`, `examples/<name>/`).
use std::path::Path;

use crate::ctx::{workspace_dir, ShellCtx};

/// Bundled example projects; `install_example` rejects anything else.
const EXAMPLES: &[&str] = &["climate-trends"];

/// Copy `src` into `dst` recursively WITHOUT overwriting existing files — a
/// re-installed example must never clobber the user's edited copy.
pub fn copy_missing(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_missing(&entry.path(), &to)?;
        } else if !to.exists() {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// Seed the agent harness (AGENTS.md, KNOWLEDGE.md, knowledge/, notes/) into a
/// freshly created dated workspace `dir`, so the agent starts with its
/// operating rules instead of an empty directory.
///
/// Non-clobbering (never overwrites a file the user already edited) so it is safe
/// to call whenever a dated folder is created. A missing/unbundled harness is a
/// soft failure logged to stderr — a new session must still open.
pub fn seed_harness(ctx: &ShellCtx, dir: &Path) {
    let Some(src) = ctx.resource("harness") else {
        eprintln!("harness resource dir not configured");
        return;
    };
    if !src.is_dir() {
        eprintln!("harness not bundled in this build: {}", src.display());
        return;
    }
    if let Err(e) = copy_missing(&src, dir) {
        eprintln!("harness seed failed: {e}");
    }
}

/// Copy a bundled example project into the workspace (idempotent, never
/// overwrites) and return its workspace-relative directory name.
pub fn install_example(ctx: &ShellCtx, name: &str) -> Result<String, String> {
    if !EXAMPLES.contains(&name) {
        return Err(format!("unknown example: {name}"));
    }
    let src = ctx
        .resource(&format!("examples/{name}"))
        .ok_or("example resource dir not configured")?;
    if !src.is_dir() {
        return Err("example not bundled in this build".into());
    }
    let dst = workspace_dir(ctx)?.join(name);
    copy_missing(&src, &dst).map_err(|e| format!("example install failed: {e}"))?;
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::copy_missing;

    #[test]
    fn copies_recursively_but_never_overwrites() {
        let base = std::env::temp_dir().join(format!("ai4s-example-{}", std::process::id()));
        let src = base.join("src");
        let dst = base.join("dst");
        std::fs::create_dir_all(src.join("data")).unwrap();
        std::fs::write(src.join("README.md"), "bundled readme").unwrap();
        std::fs::write(src.join("data/x.csv"), "a,b\n1,2\n").unwrap();

        copy_missing(&src, &dst).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("data/x.csv")).unwrap(), "a,b\n1,2\n");

        // The user edits a file; re-installing must keep the edit.
        std::fs::write(dst.join("README.md"), "user edited").unwrap();
        copy_missing(&src, &dst).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("README.md")).unwrap(), "user edited");

        let _ = std::fs::remove_dir_all(base);
    }
}
