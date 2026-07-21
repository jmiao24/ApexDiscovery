// ApexScience web server: the desktop app's shell commands (shell-core) behind
// an authenticated HTTP API, a Codex-compatible sidecar it supervises, and the built
// React frontend — one self-hosted process a browser talks to.
//
//   Browser ──(session cookie)──► this server
//     ├─ /                → static frontend (SPA fallback)
//     ├─ /api/bootstrap   → one-time nonce → HttpOnly session cookie
//     ├─ /api/login       → manual operator token fallback
//     ├─ /api/ping        → shell detection for the frontend bridge
//     ├─ /api/cmd/<name>  → shared shell-core commands (JSON in/out)
//     ├─ /api/files/…     → sandboxed workspace file serving (previews)
//     ├─ /api/upload      → multipart → workspace
//     └─ /runtime/*       → reverse proxy → agent sidecar (Basic auth
//                           injected server-side; SSE streams through)
//
// The sidecar password and provider keys never reach the browser. Binds
// 127.0.0.1 by default — pass --host 0.0.0.0 to expose,
// and put TLS in front (reverse proxy) for anything beyond localhost.
mod auth;
mod commands;
mod extensions;
mod files;
mod proxy;
mod sidecar;
mod state;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

use axum::middleware;
use axum::routing::{any, get, patch, post};
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

use shell_core::ShellCtx;
use state::AppState;

const DEFAULT_DATA_DIR_NAME: &str = ".apex-science";
const LEGACY_DATA_DIR_NAME: &str = ".openscience-server";

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn default_data_dir(home: &str) -> PathBuf {
    let home = PathBuf::from(home);
    let current = home.join(DEFAULT_DATA_DIR_NAME);
    let legacy = home.join(LEGACY_DATA_DIR_NAME);

    if current.exists() || !legacy.exists() {
        return current;
    }

    match std::fs::rename(&legacy, &current) {
        Ok(()) => {
            eprintln!(
                "migrated APEX Discovery data from {} to {}",
                legacy.display(),
                current.display()
            );
            current
        }
        Err(error) => {
            eprintln!(
                "warning: could not migrate {} to {}: {error}; using the legacy directory for this run",
                legacy.display(),
                current.display()
            );
            legacy
        }
    }
}

/// One `--flag value` from argv, or None.
fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

fn open_browser(url: &str) -> Result<(), String> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(url);
        command
    } else if cfg!(windows) {
        let mut command =
            Command::new(std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into()));
        command.args(["/d", "/s", "/c", "start", "", url]);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open the browser: {e}"))
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        eprintln!(
            "apexscience-server — self-hosted web workbench\n\n\
             Options (flag > env > default):\n\
             --host <ip>            bind address            APEX_HOST      (default 127.0.0.1)\n\
             --port <port>          bind port               APEX_PORT      (default: automatic on localhost)\n\
             --token <token>        login token             APEX_TOKEN     (default: generated, printed)\n\
             --data-dir <dir>       app-private data dir    APEX_DATA_DIR  (default ~/.apex-science)\n\
             --frontend-dir <dir>   built frontend to serve APEX_FRONTEND_DIR (default ./dist)\n\
             --resource-dir <dir>   bundled skills/harness  APEX_RESOURCE_DIR (optional)\n\
             --opencode-bin <path>  agent sidecar           APEX_OPENCODE_BIN (default: next to server, then PATH)\n\
             --no-open              do not open the default browser"
        );
        return;
    }

    let host = arg_value(&args, "--host")
        .or_else(|| std::env::var("APEX_HOST").ok())
        .unwrap_or_else(|| "127.0.0.1".into());
    let explicit_port = arg_value(&args, "--port")
        .or_else(|| std::env::var("APEX_PORT").ok())
        .and_then(|p| p.parse().ok());
    let loopback = is_loopback_host(&host);
    let port: u16 = explicit_port.unwrap_or(if loopback { 0 } else { 3411 });

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let data_dir = arg_value(&args, "--data-dir")
        .map(PathBuf::from)
        .or_else(|| env_path("APEX_DATA_DIR"))
        .unwrap_or_else(|| default_data_dir(&home));
    let frontend_dir = arg_value(&args, "--frontend-dir")
        .map(PathBuf::from)
        .or_else(|| env_path("APEX_FRONTEND_DIR"))
        .unwrap_or_else(|| PathBuf::from("dist"));
    let resource_dir = arg_value(&args, "--resource-dir")
        .map(PathBuf::from)
        .or_else(|| env_path("APEX_RESOURCE_DIR"));

    let ctx = ShellCtx {
        data_dir: data_dir.clone(),
        document_dir: None,
        resource_dir,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };

    // Login token: explicit wins; otherwise generate one per run and print it.
    let (token, generated) = match arg_value(&args, "--token")
        .or_else(|| std::env::var("APEX_TOKEN").ok())
        .filter(|t| !t.is_empty())
    {
        Some(t) => (t, false),
        None => (shell_core::util::random_hex(16), true),
    };

    let opencode_bin = arg_value(&args, "--opencode-bin")
        .map(PathBuf::from)
        .or_else(|| env_path("APEX_OPENCODE_BIN"))
        .unwrap_or_else(sidecar::default_opencode_bin);

    let bootstrap_nonce = loopback.then(|| shell_core::util::random_hex(32));
    let state = Arc::new(AppState::new(
        ctx,
        token.clone(),
        bootstrap_nonce.clone(),
        opencode_bin,
    ));

    // Start the sidecar up front so the first page load can connect immediately.
    match state.start_sidecar().await {
        Ok(url) => eprintln!("opencode sidecar running at {url} (proxied at /runtime)"),
        Err(e) => eprintln!("warning: opencode sidecar failed to start: {e}"),
    }

    let spa =
        ServeDir::new(&frontend_dir).fallback(ServeFile::new(frontend_dir.join("index.html")));

    let api = Router::new()
        .route("/cmd/{name}", post(commands::run_command))
        .route(
            "/extensions",
            get(extensions::list_extensions).post(extensions::install_extension),
        )
        .route(
            "/extensions/{name}",
            patch(extensions::set_extension_enabled).delete(extensions::remove_extension),
        )
        .route("/files/{scope}/{*path}", get(files::serve_file))
        .route("/upload", post(files::upload))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_session,
        ))
        .route("/bootstrap", get(auth::bootstrap))
        .route("/login", post(auth::login))
        .route("/ping", get(auth::ping));

    let app = Router::new()
        .nest("/api", api)
        .route(
            "/runtime/{*path}",
            any(proxy::proxy_runtime).layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_session,
            )),
        )
        .fallback_service(spa)
        .with_state(state.clone())
        // Uploads and artifact bodies can be large.
        .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024));

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .unwrap_or_else(|_| panic!("invalid bind address {host}:{port}"));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("could not bind {addr}: {e}"));

    let bound_addr = listener.local_addr().expect("bound address");
    eprintln!("APEX Discovery server listening on http://{bound_addr}");
    if generated {
        eprintln!("login token (set APEX_TOKEN to pin one): {token}");
    }
    if !loopback {
        eprintln!("warning: bound to a non-loopback address — put TLS (a reverse proxy) in front.");
    }
    if loopback && !args.iter().any(|arg| arg == "--no-open") {
        if let Some(nonce) = bootstrap_nonce {
            let url = format!(
                "http://127.0.0.1:{}/api/bootstrap?nonce={nonce}",
                bound_addr.port()
            );
            if let Err(error) = open_browser(&url) {
                eprintln!(
                    "warning: {error}; open http://127.0.0.1:{} and use the printed access token",
                    bound_addr.port()
                );
            }
        }
    }

    // Kill the sidecar on ctrl-c so it never orphans.
    let shutdown_state = state.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = tokio::signal::ctrl_c().await;
            shutdown_state.kill_sidecar().await;
        })
        .await
        .expect("server error");
}

#[cfg(test)]
mod tests {
    use super::{default_data_dir, DEFAULT_DATA_DIR_NAME, LEGACY_DATA_DIR_NAME};
    use std::fs;

    fn temporary_home(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "apex-data-dir-{name}-{}-{}",
            std::process::id(),
            shell_core::util::random_hex(6)
        ))
    }

    #[test]
    fn uses_the_apex_science_directory_for_new_installs() {
        let home = temporary_home("new");
        fs::create_dir_all(&home).unwrap();

        assert_eq!(
            default_data_dir(home.to_str().unwrap()),
            home.join(DEFAULT_DATA_DIR_NAME)
        );

        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn migrates_the_legacy_directory_when_the_new_directory_is_absent() {
        let home = temporary_home("migrate");
        let legacy = home.join(LEGACY_DATA_DIR_NAME);
        fs::create_dir_all(legacy.join("runtime")).unwrap();
        fs::write(legacy.join("runtime/session.txt"), "session-state").unwrap();

        let current = default_data_dir(home.to_str().unwrap());

        assert_eq!(current, home.join(DEFAULT_DATA_DIR_NAME));
        assert!(!legacy.exists());
        assert_eq!(
            fs::read_to_string(current.join("runtime/session.txt")).unwrap(),
            "session-state"
        );

        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn preserves_both_directories_when_the_new_directory_already_exists() {
        let home = temporary_home("existing");
        let current = home.join(DEFAULT_DATA_DIR_NAME);
        let legacy = home.join(LEGACY_DATA_DIR_NAME);
        fs::create_dir_all(&current).unwrap();
        fs::create_dir_all(&legacy).unwrap();
        fs::write(current.join("owner"), "current").unwrap();
        fs::write(legacy.join("owner"), "legacy").unwrap();

        assert_eq!(default_data_dir(home.to_str().unwrap()), current);
        assert_eq!(
            fs::read_to_string(current.join("owner")).unwrap(),
            "current"
        );
        assert_eq!(fs::read_to_string(legacy.join("owner")).unwrap(), "legacy");

        fs::remove_dir_all(home).unwrap();
    }
}
