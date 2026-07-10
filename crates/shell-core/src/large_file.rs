// Large-file memory-pointer probe (P0-6). When a file is too big to preview,
// the app can still introspect it WITHOUT loading it: this runs the bundled
// `large-file` skill's stdlib probe (schema / shape / sample / key numbers) and
// returns its compact JSON pointer. Bounded memory — the probe streams and
// samples; it never loads the whole file.
use std::path::{Path, PathBuf};

use crate::util::{enriched_path, quiet_command};

/// First path in `candidates` that exists on disk (the bundled resource in a
/// packaged app; the in-repo skill in a dev run).
pub fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// Introspect `full` (an already-sandbox-resolved workspace file) with the
/// probe `script`, running on `python`, and return the JSON pointer string.
pub fn probe_large_file(python: &str, script: &Path, full: &Path) -> Result<String, String> {
    if !full.is_file() {
        return Err("no such file".into());
    }
    let mut cmd = quiet_command(python);
    cmd.arg(script).arg(full);
    // Same enriched PATH as the kernel/agent so a conda/homebrew python resolves.
    cmd.env("PATH", enriched_path());
    let out = cmd.output().map_err(|e| format!("probe failed to run: {e}"))?;
    if !out.status.success() {
        return Err(format!("probe error: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::first_existing;

    #[test]
    fn first_existing_picks_the_first_present_file() {
        let dir = std::env::temp_dir().join(format!("os-probe-locate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real = dir.join("large_file_probe.py");
        std::fs::write(&real, b"# probe").unwrap();

        let missing = dir.join("nope.py");
        // Bundled-resource-missing → falls through to the present dev path.
        assert_eq!(first_existing(&[missing.clone(), real.clone()]), Some(real));
        // Nothing present → None (caller surfaces a clear error).
        assert_eq!(first_existing(&[missing, dir.join("also-nope.py")]), None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
