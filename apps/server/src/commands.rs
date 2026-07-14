// POST /api/cmd/<name> — the shared shell-core commands, JSON in / JSON out.
// Parameter keys are camelCase, exactly what the frontend already sends to
// Tauri's invoke (Tauri camelCases the wire format too), so the bridge passes
// its existing argument objects through unchanged.
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

use shell_core::ctx::{base_workspace_dir, scope_root, workspace_dir};
use shell_core::{artifact, assets, git_snapshot, preview, provenance, runs, runs_index, runtime};

use crate::state::AppState;

fn err(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

fn bad_request(message: impl std::fmt::Display) -> Response {
    err(StatusCode::BAD_REQUEST, message.to_string())
}

#[allow(clippy::result_large_err)] // Axum Response is the command router's direct error type.
fn parse<T: serde::de::DeserializeOwned>(params: &Value) -> Result<T, Response> {
    serde_json::from_value(params.clone()).map_err(|e| bad_request(format!("bad params: {e}")))
}

/// The Python agent-adjacent commands run on (env capture, large-file probe).
/// APEX_PYTHON wins; otherwise the first of python3/python that runs. Cached —
/// same once-per-run behavior as the desktop kernel's resolution.
fn server_python() -> Option<String> {
    static CACHE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(|| {
            let works = |bin: &str| {
                let mut c = shell_core::util::quiet_command(bin);
                c.arg("--version");
                c.env("PATH", shell_core::util::enriched_path());
                c.output().map(|o| o.status.success()).unwrap_or(false)
            };
            std::env::var("APEX_PYTHON")
                .ok()
                .filter(|p| !p.is_empty())
                .or_else(|| ["python3", "python"].iter().find(|b| works(b)).map(|b| b.to_string()))
        })
        .clone()
}

// camelCase param shapes, matching the frontend's invoke argument objects.
#[derive(serde::Deserialize)]
struct PathParam {
    path: String,
}
#[derive(serde::Deserialize)]
struct ScopedPath {
    path: String,
    #[serde(default)]
    root: Option<String>,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordProvenance {
    path: String,
    tool: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    diff: Option<String>,
    #[serde(default)]
    log: Option<String>,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordRun {
    command: String,
    #[serde(default)]
    log: Option<String>,
    #[serde(default)]
    started_at: Option<u64>,
    #[serde(default)]
    ended_at: Option<u64>,
    status: String,
    #[serde(default)]
    surface: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureOpencode {
    provider: String,
    api_key: String,
    model: String,
    #[serde(default)]
    base_url: Option<String>,
}

pub async fn run_command(
    State(state): State<Arc<AppState>>,
    AxumPath(name): AxumPath<String>,
    body: Option<Json<Value>>,
) -> Response {
    let params = body.map(|Json(v)| v).unwrap_or(Value::Null);

    // Commands that restart the sidecar need the async lock — handle first.
    match name.as_str() {
        "set_approval_mode" => {
            #[derive(serde::Deserialize)]
            struct P {
                mode: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            if let Err(e) = runtime::set_approval_mode(&state.ctx, &p.mode) {
                return bad_request(e);
            }
            return match state.restart_sidecar().await {
                Ok(_) => Json(json!("/runtime")).into_response(),
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
        }
        "set_proxy_setting" => {
            #[derive(serde::Deserialize)]
            struct P {
                mode: String,
                url: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            if let Err(e) = runtime::set_proxy_setting(&state.ctx, &p.mode, &p.url) {
                return bad_request(e);
            }
            return match state.restart_sidecar().await {
                Ok(_) => Json(json!("/runtime")).into_response(),
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
        }
        "configure_opencode" => {
            let p: ConfigureOpencode = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            if let Err(e) = runtime::configure_opencode(
                &state.ctx,
                &p.provider,
                &p.api_key,
                &p.model,
                p.base_url.as_deref(),
            ) {
                return bad_request(e);
            }
            return match state.restart_sidecar().await {
                Ok(_) => Json(json!("/runtime")).into_response(),
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
        }
        "remove_config_entry" => {
            #[derive(serde::Deserialize)]
            struct P {
                section: String,
                key: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            if let Err(e) = runtime::remove_config_entry(&state.ctx, &p.section, &p.key) {
                return bad_request(e);
            }
            return match state.restart_sidecar().await {
                Ok(_) => Json(json!(null)).into_response(),
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
        }
        "import_opencode_login" => {
            let imported = match runtime::import_opencode_login(&state.ctx) {
                Ok(v) => v,
                Err(e) => return bad_request(e),
            };
            if imported {
                if let Err(e) = state.restart_sidecar().await {
                    return err(StatusCode::INTERNAL_SERVER_ERROR, e);
                }
            }
            return Json(json!(imported)).into_response();
        }
        "start_runtime" => {
            // The browser never reaches the sidecar directly — ensure it runs
            // and hand back the proxy mount.
            return match state.start_sidecar().await {
                Ok(_) => Json(json!("/runtime")).into_response(),
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e),
            };
        }
        _ => {}
    }

    // Everything else is synchronous filesystem/process work — run it off the
    // async runtime (record_run walks the workspace; pip freeze takes seconds).
    let ctx = state.ctx.clone();
    let result = tokio::task::spawn_blocking(move || dispatch_blocking(&ctx, &name, params)).await;
    match result {
        Ok(resp) => resp,
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("task failed: {e}")),
    }
}

fn ok<T: serde::Serialize>(value: T) -> Response {
    Json(value).into_response()
}

fn from_result<T: serde::Serialize>(r: Result<T, String>) -> Response {
    match r {
        Ok(v) => ok(v),
        Err(e) => bad_request(e),
    }
}

fn dispatch_blocking(ctx: &shell_core::ShellCtx, name: &str, params: Value) -> Response {
    match name {
        "workspace_path" => from_result(workspace_dir(ctx).map(|p| p.to_string_lossy().to_string())),
        "workspace_base" => {
            from_result(base_workspace_dir(ctx).map(|p| p.to_string_lossy().to_string()))
        }
        "set_workspace_base" => {
            let p: PathParam = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            from_result(runtime::set_workspace_base(ctx, &p.path))
        }
        "set_workspace" => {
            let p: PathParam = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            from_result(runtime::set_workspace(ctx, &p.path))
        }
        "new_dated_workspace" => {
            #[derive(serde::Deserialize)]
            struct P {
                name: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            from_result(runtime::new_dated_workspace(ctx, &p.name))
        }
        "mark_session" => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct P {
                session_id: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            from_result(runtime::mark_session(ctx, &p.session_id))
        }
        "get_approval_mode" => from_result(runtime::get_approval_mode(ctx)),
        "get_proxy_setting" => ok(runtime::get_proxy_setting(ctx)),
        "commit_workspace_snapshot" => {
            #[derive(serde::Deserialize)]
            struct P {
                message: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(git_snapshot::commit(&root, &p.message))
        }
        "install_example" => {
            #[derive(serde::Deserialize)]
            struct P {
                name: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            from_result(assets::install_example(ctx, &p.name))
        }
        "log_debug" => {
            #[derive(serde::Deserialize)]
            struct P {
                message: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            shell_core::debug_log::log_debug(&ctx.data_dir, &p.message);
            ok(json!(null))
        }
        "resolve_artifact" => {
            let p: PathParam = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            ok(artifact::locate_under(&root, &p.path))
        }
        "read_artifact" => {
            let p: ScopedPath = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match scope_root(ctx, p.root.as_deref()) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(artifact::read_artifact(&root, &p.path))
        }
        "absolute_path" => {
            let p: ScopedPath = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match scope_root(ctx, p.root.as_deref()) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(
                artifact::resolve_under(&root, &p.path).map(|f| f.to_string_lossy().to_string()),
            )
        }
        "list_notebooks" => {
            #[derive(serde::Deserialize)]
            struct P {
                #[serde(default)]
                root: Option<String>,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match scope_root(ctx, p.root.as_deref()) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(artifact::list_notebooks(&root))
        }
        "list_dir" => {
            #[derive(serde::Deserialize)]
            struct P {
                rel: String,
                #[serde(default)]
                root: Option<String>,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match scope_root(ctx, p.root.as_deref()) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(artifact::dir_entries(&root, &p.rel))
        }
        "write_workspace_file" => {
            #[derive(serde::Deserialize)]
            struct P {
                path: String,
                content: String,
                #[serde(default)]
                root: Option<String>,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match scope_root(ctx, p.root.as_deref()) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(artifact::write_workspace_file(&root, &p.path, &p.content))
        }
        "add_text_to_workspace" => {
            #[derive(serde::Deserialize)]
            struct P {
                filename: String,
                content: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let ws = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(artifact::add_text_to_workspace(&ws, &p.filename, &p.content))
        }
        "record_provenance" => {
            let p: RecordProvenance = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            // Same lock discipline as the desktop: serialize provenance appends.
            let _guard = prov_lock().lock().unwrap_or_else(|e| e.into_inner());
            let env = provenance::capture_env(server_python().as_deref(), &root, &ctx.app_version);
            let record = provenance::append_record(
                &root, &p.path, &p.tool, p.session_id, p.model, p.content, p.diff, p.log,
                Some(env), None,
            );
            drop(_guard);
            if let Ok(r) = &record {
                git_snapshot::commit_best_effort(&root, &format!("Record {}", r.path));
            }
            from_result(record)
        }
        "list_provenance" => {
            let p: PathParam = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(provenance::versions_for(&root, &p.path))
        }
        "read_env_lockfile" => {
            #[derive(serde::Deserialize)]
            struct P {
                hash: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(provenance::read_env_lockfile(&root, &p.hash))
        }
        "record_run" => {
            let p: RecordRun = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            // Env capture before the locks (first call shells out for seconds).
            let env = provenance::capture_env(server_python().as_deref(), &root, &ctx.app_version);
            let _run_guard = run_lock().lock().unwrap_or_else(|e| e.into_inner());
            let _prov_guard = prov_lock().lock().unwrap_or_else(|e| e.into_inner());
            let record = runs::record_run_inner(
                &root,
                &p.command,
                p.log.as_deref(),
                p.started_at,
                p.ended_at,
                &p.status,
                p.surface,
                p.session_id,
                p.model,
                Some(env),
            );
            drop(_prov_guard);
            drop(_run_guard);
            if let Ok(r) = &record {
                git_snapshot::commit_best_effort(&root, &format!("Record run {}", r.run_id));
            }
            from_result(record)
        }
        "list_runs" => {
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            ok(runs::read_runs(&root))
        }
        "read_run_log" => {
            #[derive(serde::Deserialize)]
            struct P {
                hash: String,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(runs::read_log(&root, &p.hash))
        }
        "query_runs_cmd" => {
            #[derive(serde::Deserialize)]
            struct P {
                query: runs_index::RunQuery,
            }
            let p: P = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let base = match base_workspace_dir(ctx) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            from_result(runs_index::query_runs_synced(&base, &p.query))
        }
        "preview_url" => {
            // Web previews are served by this server itself (the desktop's
            // loopback preview server is unreachable from a remote browser):
            // same token-free shape, gated by the session cookie instead.
            let p: ScopedPath = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let scope = match p.root.as_deref().unwrap_or("workspace") {
                "workspace" => "w",
                "base" => "b",
                other => return bad_request(format!("unknown root scope: {other}")),
            };
            let root = match scope_root(ctx, p.root.as_deref()) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            let rel = match preview::relativize(&root, &p.path) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            let encoded: Vec<String> = rel.split('/').map(preview::encode_segment).collect();
            ok(format!("/api/files/{scope}/{}", encoded.join("/")))
        }
        "probe_large_file" => {
            let p: ScopedPath = match parse(&params) {
                Ok(p) => p,
                Err(r) => return r,
            };
            let root = match scope_root(ctx, p.root.as_deref()) {
                Ok(r) => r,
                Err(e) => return bad_request(e),
            };
            let full = match artifact::resolve_under(&root, &p.path) {
                Ok(f) => f,
                Err(e) => return bad_request(e),
            };
            let Some(python) = server_python() else {
                return bad_request("no Python found on the server (set APEX_PYTHON)");
            };
            let Some(script) = probe_script(ctx) else {
                return bad_request("large-file probe not found");
            };
            from_result(shell_core::large_file::probe_large_file(&python, &script, &full))
        }
        other => err(StatusCode::NOT_FOUND, format!("unknown command: {other}")),
    }
}

/// Locate the large-file probe: bundled resource first, then the in-repo path
/// for `cargo run` during development.
fn probe_script(ctx: &shell_core::ShellCtx) -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(p) = ctx.resource("skills-core/large-file/large_file_probe.py") {
        candidates.push(p);
    }
    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../runtime/skills/core/large-file/large_file_probe.py"),
    );
    shell_core::large_file::first_existing(&candidates)
}

// The same append-serialization the desktop gets from Tauri-managed state.
fn prov_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

fn run_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}
