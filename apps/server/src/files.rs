// Workspace file serving (previews) and uploads. The web replacement for the
// desktop's loopback preview server and native file-picker: same sandbox
// (resolve_under), same MIME table, same single-range semantics — gated by the
// session instead of a per-run URL token.
use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;

use axum::extract::{Multipart, Path as AxumPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use shell_core::artifact::{mime_for, resolve_under, unique_name};
use shell_core::ctx::{scope_root, workspace_dir};
use shell_core::preview::parse_range;

use crate::state::AppState;

/// GET /api/files/{scope}/{path} — scope "w" = active workspace, "b" = base.
pub async fn serve_file(
    State(state): State<Arc<AppState>>,
    AxumPath((scope, path)): AxumPath<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let root_kind = match scope.as_str() {
        "w" => "workspace",
        "b" => "base",
        _ => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    let ctx = state.ctx.clone();
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_range);

    // Blocking file IO off the async runtime.
    let result = tokio::task::spawn_blocking(move || {
        let root = scope_root(&ctx, Some(root_kind))?;
        let full = resolve_under(&root, &path)?;
        if !full.is_file() {
            return Err("not found".to_string());
        }
        let ext = full.extension().and_then(|s| s.to_str()).unwrap_or("");
        let (mime, _) = mime_for(ext);
        let total = std::fs::metadata(&full).map_err(|e| e.to_string())?.len();

        if let Some((start_opt, end_opt)) = range {
            // Resolve an inclusive [start, end] within [0, total-1] — the same
            // arithmetic as the desktop preview server.
            let (start, end) = match (start_opt, end_opt) {
                (Some(s), Some(e)) => (s, e.min(total.saturating_sub(1))),
                (Some(s), None) => (s, total.saturating_sub(1)),
                (None, Some(n)) => (total.saturating_sub(n), total.saturating_sub(1)),
                (None, None) => (0, total.saturating_sub(1)),
            };
            if total == 0 || start > end || start >= total {
                return Ok(FilePayload::Unsatisfiable { total });
            }
            let len = end - start + 1;
            let mut body = vec![0u8; len as usize];
            let mut f = std::fs::File::open(&full).map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
            f.read_exact(&mut body).map_err(|e| e.to_string())?;
            return Ok(FilePayload::Partial {
                mime,
                body,
                start,
                end,
                total,
            });
        }
        let body = std::fs::read(&full).map_err(|e| e.to_string())?;
        Ok(FilePayload::Full { mime, body })
    })
    .await;

    match result {
        Ok(Ok(payload)) => payload.into_response(),
        Ok(Err(_)) => (StatusCode::NOT_FOUND, "not found").into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("task failed: {e}"),
        )
            .into_response(),
    }
}

enum FilePayload {
    Full {
        mime: &'static str,
        body: Vec<u8>,
    },
    Partial {
        mime: &'static str,
        body: Vec<u8>,
        start: u64,
        end: u64,
        total: u64,
    },
    Unsatisfiable {
        total: u64,
    },
}

impl IntoResponse for FilePayload {
    fn into_response(self) -> Response {
        match self {
            FilePayload::Full { mime, body } => (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, mime.to_string()),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
                ],
                body,
            )
                .into_response(),
            FilePayload::Partial {
                mime,
                body,
                start,
                end,
                total,
            } => (
                StatusCode::PARTIAL_CONTENT,
                [
                    (header::CONTENT_TYPE, mime.to_string()),
                    (
                        header::CONTENT_RANGE,
                        format!("bytes {start}-{end}/{total}"),
                    ),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
                ],
                body,
            )
                .into_response(),
            FilePayload::Unsatisfiable { total } => (
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{total}"))],
                Vec::new(),
            )
                .into_response(),
        }
    }
}

/// POST /api/upload (multipart) — copy browser-picked files into the active
/// workspace, deduplicating names exactly like the desktop dialog flow.
/// Returns the workspace-relative names written.
pub async fn upload(State(state): State<Arc<AppState>>, mut multipart: Multipart) -> Response {
    let ctx = state.ctx.clone();
    let ws = match tokio::task::spawn_blocking(move || workspace_dir(&ctx)).await {
        Ok(Ok(ws)) => ws,
        Ok(Err(e)) => return (StatusCode::BAD_REQUEST, e).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let mut added: Vec<String> = Vec::new();
    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                let Some(filename) = field.file_name().map(|s| s.to_string()) else {
                    continue; // non-file field
                };
                let bytes = match field.bytes().await {
                    Ok(b) => b,
                    Err(e) => {
                        return (StatusCode::BAD_REQUEST, format!("upload failed: {e}"))
                            .into_response()
                    }
                };
                let ws = ws.clone();
                let written = tokio::task::spawn_blocking(move || {
                    // unique_name + write, same collision behavior as desktop.
                    let base = std::path::Path::new(&filename)
                        .file_name()
                        .ok_or("invalid file name")?
                        .to_string_lossy()
                        .to_string();
                    let name = unique_name(&ws, &base);
                    std::fs::write(ws.join(&name), &bytes)
                        .map_err(|e| format!("write failed: {e}"))?;
                    Ok::<String, String>(name)
                })
                .await;
                match written {
                    Ok(Ok(name)) => added.push(name),
                    Ok(Err(e)) => return (StatusCode::BAD_REQUEST, e).into_response(),
                    Err(e) => {
                        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, format!("upload failed: {e}")).into_response()
            }
        }
    }

    if !added.is_empty() {
        let ws = ws.clone();
        let _ = tokio::task::spawn_blocking(move || {
            shell_core::git_snapshot::commit_best_effort(&ws, "Add workspace files");
        })
        .await;
    }
    Json(json!(added)).into_response()
}
