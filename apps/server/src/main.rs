// ApexScience web server: the desktop app's shell commands (shell-core) behind
// an authenticated HTTP API, an OpenCode sidecar it supervises, and the built
// React frontend — one self-hosted process a browser talks to.
//
//   Browser ──(session cookie)──► this server
//     ├─ /                → static frontend (SPA fallback)
//     ├─ /api/login       → token → HttpOnly session cookie
//     ├─ /api/ping        → shell detection for the frontend bridge
//     ├─ /api/cmd/<name>  → shared shell-core commands (JSON in/out)
//     ├─ /api/files/…     → sandboxed workspace file serving (previews)
//     ├─ /api/upload      → multipart → workspace
//     └─ /runtime/*       → reverse proxy → OpenCode sidecar (Basic auth
//                           injected server-side; SSE streams through)
//
// The sidecar password never reaches the browser; the browser only holds the
// session token. Binds 127.0.0.1 by default — pass --host 0.0.0.0 to expose,
// and put TLS in front (reverse proxy) for anything beyond localhost.
mod auth;
mod commands;
mod files;
mod proxy;
mod sidecar;
mod state;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::http::{header, HeaderValue};
use axum::middleware;
use axum::routing::{any, get, post};
use axum::Router;
use tower::ServiceBuilder;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

use shell_core::ShellCtx;
use state::AppState;

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key).ok().filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// One `--flag value` from argv, or None.
fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        eprintln!(
            "apexscience-server — self-hosted web workbench\n\n\
             Options (flag > env > default):\n\
             --host <ip>            bind address            APEX_HOST      (default 127.0.0.1)\n\
             --port <port>          bind port               APEX_PORT      (default 3411)\n\
             --token <token>        login token             APEX_TOKEN     (default: generated, printed)\n\
             --data-dir <dir>       app-private data dir    APEX_DATA_DIR  (default ~/.openscience-server)\n\
             --frontend-dir <dir>   built frontend to serve APEX_FRONTEND_DIR (default ./dist)\n\
             --resource-dir <dir>   bundled skills/harness  APEX_RESOURCE_DIR (optional)\n\
             --opencode-bin <path>  opencode binary         APEX_OPENCODE_BIN (default: next to server, then PATH)"
        );
        return;
    }

    let host = arg_value(&args, "--host")
        .or_else(|| std::env::var("APEX_HOST").ok())
        .unwrap_or_else(|| "127.0.0.1".into());
    let port: u16 = arg_value(&args, "--port")
        .or_else(|| std::env::var("APEX_PORT").ok())
        .and_then(|p| p.parse().ok())
        .unwrap_or(3411);

    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    let data_dir = arg_value(&args, "--data-dir")
        .map(PathBuf::from)
        .or_else(|| env_path("APEX_DATA_DIR"))
        .unwrap_or_else(|| PathBuf::from(&home).join(".openscience-server"));
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

    let state = Arc::new(AppState::new(ctx, token.clone(), opencode_bin));

    // Start the sidecar up front so the first page load can connect immediately.
    match state.start_sidecar().await {
        Ok(url) => eprintln!("opencode sidecar running at {url} (proxied at /runtime)"),
        Err(e) => eprintln!("warning: opencode sidecar failed to start: {e}"),
    }

    // Cache the way a hashed-asset build wants to be cached. Without this the
    // browser heuristically caches index.html, keeps pointing at the PREVIOUS
    // build's asset hashes, and the user stays on a stale app after every
    // redeploy. index.html must be revalidated; /assets/* is content-hashed, so
    // a given URL never changes and can be kept forever.
    let assets = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ))
        .service(ServeDir::new(frontend_dir.join("assets")));

    let spa = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
        .service(
            ServeDir::new(&frontend_dir)
                .fallback(ServeFile::new(frontend_dir.join("index.html"))),
        );

    let api = Router::new()
        .route("/cmd/{name}", post(commands::run_command))
        .route("/files/{scope}/{*path}", get(files::serve_file))
        .route("/upload", post(files::upload))
        .layer(middleware::from_fn_with_state(state.clone(), auth::require_session))
        .route("/login", post(auth::login))
        .route("/ping", get(auth::ping));

    let app = Router::new()
        .nest("/api", api)
        .route(
            "/runtime/{*path}",
            any(proxy::proxy_runtime)
                .layer(middleware::from_fn_with_state(state.clone(), auth::require_session)),
        )
        .nest_service("/assets", assets)
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

    eprintln!("ApexScience server listening on http://{addr}");
    if generated {
        eprintln!("login token (set APEX_TOKEN to pin one): {token}");
    }
    if host != "127.0.0.1" && host != "localhost" {
        eprintln!("warning: bound to a non-loopback address — put TLS (a reverse proxy) in front.");
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
