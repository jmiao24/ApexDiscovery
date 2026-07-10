// Appends frontend diagnostics to <data-dir>/debug.log so we can see what the
// UI experiences (connection attempts, SSE events, errors) in packaged builds.
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn log_debug(data_dir: &Path, message: &str) {
    let _ = std::fs::create_dir_all(data_dir);
    let path = data_dir.join("debug.log");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{ts} {message}");
    }
}
