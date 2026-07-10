// Artifact preview URLs — Tauri wrapper over shell_core::preview (the tiny
// loopback HTTP file server). Serving workspace files over real
// http://127.0.0.1 with correct MIME lets the webview use its NATIVE viewers
// (WKWebView and WebView2 both render PDF, images, HTML, media inline).
use std::sync::Mutex;
use tauri::{AppHandle, State};

use shell_core::preview::{encode_segment, relativize, serve};

use crate::runtime::{base_workspace_dir, ctx, workspace_dir};

#[derive(Default)]
pub struct PreviewState(Mutex<Option<(u16, String)>>);

/// URL a file is previewable at (starts the server on first use). `root`
/// chooses the tree: the active workspace (default) or the base folder.
#[tauri::command]
pub fn preview_url(
    app: AppHandle,
    state: State<'_, PreviewState>,
    path: String,
    root: Option<String>,
) -> Result<String, String> {
    let mut guard = state.0.lock().unwrap();
    let (port, token) = match guard.clone() {
        Some(pt) => pt,
        None => {
            let handle = app.clone();
            let token = shell_core::runtime::preview_token();
            let p = serve(&token, move |scope| match scope {
                "w" => workspace_dir(&handle).ok(),
                "b" => base_workspace_dir(&handle).ok(),
                _ => None,
            })
            .map_err(|e| e.to_string())?;
            *guard = Some((p, token.clone()));
            (p, token)
        }
    };
    let scope = match root.as_deref().unwrap_or("workspace") {
        "workspace" => "w",
        "base" => "b",
        other => return Err(format!("unknown root scope: {other}")),
    };
    let rel = relativize(&shell_core::ctx::scope_root(&ctx(&app)?, root.as_deref())?, &path)?;
    let encoded: Vec<String> = rel.split('/').map(encode_segment).collect();
    Ok(format!("http://127.0.0.1:{port}/{token}/{scope}/{}", encoded.join("/")))
}
