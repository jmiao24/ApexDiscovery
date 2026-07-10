// /runtime/* → the OpenCode sidecar. The browser's OpenCodeClient talks to
// this mount exactly as it would to a local `opencode serve`; the proxy adds
// the sidecar's per-run Basic-auth password server-side (it never reaches the
// browser) and streams response bodies through unbuffered, which is what keeps
// the /event SSE stream live.
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

/// The sidecar's Basic-auth header value (username "opencode", per-run password).
fn sidecar_auth() -> String {
    let creds = format!("opencode:{}", shell_core::util::server_password());
    format!("Basic {}", shell_core::artifact::base64_encode(creds.as_bytes()))
}

/// Hop-by-hop headers a proxy must not forward (RFC 9110 §7.6.1).
fn is_hop_by_hop(name: &header::HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "content-length"
    )
}

pub async fn proxy_runtime(
    State(state): State<Arc<AppState>>,
    AxumPath(path): AxumPath<String>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let base = match state.sidecar_url().await {
        Ok(u) => u,
        Err(e) => return (StatusCode::BAD_GATEWAY, e).into_response(),
    };
    let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    let target = format!("{base}/{path}{query}");

    let reqw_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return (StatusCode::METHOD_NOT_ALLOWED, "bad method").into_response(),
    };

    let mut req = state.client.request(reqw_method, &target);
    for (name, value) in headers.iter() {
        if is_hop_by_hop(name) || name == header::AUTHORIZATION || name == header::COOKIE {
            // Session cookies stay on this server; auth is replaced below.
            continue;
        }
        if let Ok(v) = value.to_str() {
            req = req.header(name.as_str(), v);
        }
    }
    req = req.header(header::AUTHORIZATION.as_str(), sidecar_auth());

    // Stream the request body through (turn ends, file writes — small; but
    // never buffer what we don't have to).
    let body_stream = body.into_data_stream();
    req = req.body(reqwest::Body::wrap_stream(body_stream));

    let upstream = match req.send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("runtime unreachable: {e}")).into_response(),
    };

    let status = StatusCode::from_u16(upstream.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response_headers = HeaderMap::new();
    for (name, value) in upstream.headers().iter() {
        let Ok(n) = header::HeaderName::from_bytes(name.as_str().as_bytes()) else { continue };
        if is_hop_by_hop(&n) {
            continue;
        }
        if let Ok(v) = header::HeaderValue::from_bytes(value.as_bytes()) {
            response_headers.insert(n, v);
        }
    }

    // Stream the body — SSE (/event, /global/event) stays open indefinitely.
    let stream = upstream.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    response
}
