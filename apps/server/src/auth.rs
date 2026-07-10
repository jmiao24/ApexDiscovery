// Single-user session auth: POST /api/login exchanges the server token for an
// HttpOnly cookie; everything under /api (except login/ping) and /runtime
// requires it. `Authorization: Bearer <token>` also works for programmatic use.
use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::state::AppState;

const COOKIE_NAME: &str = "apex_session";

/// Constant-time-ish comparison (length leak is fine for a random 128-bit token).
fn token_matches(expected: &str, got: &str) -> bool {
    expected.len() == got.len()
        && expected
            .bytes()
            .zip(got.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn session_cookie_value(req: &Request<Body>) -> Option<String> {
    let cookies = req.headers().get(header::COOKIE)?.to_str().ok()?;
    cookies.split(';').find_map(|c| {
        let (k, v) = c.trim().split_once('=')?;
        (k == COOKIE_NAME).then(|| v.to_string())
    })
}

fn bearer_value(req: &Request<Body>) -> Option<String> {
    let auth = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    auth.strip_prefix("Bearer ").map(|t| t.trim().to_string())
}

pub fn is_authenticated(state: &AppState, req: &Request<Body>) -> bool {
    session_cookie_value(req)
        .or_else(|| bearer_value(req))
        .is_some_and(|t| token_matches(&state.token, &t))
}

pub async fn require_session(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if !is_authenticated(&state, &req) {
        return (StatusCode::UNAUTHORIZED, "not logged in").into_response();
    }
    next.run(req).await
}

#[derive(serde::Deserialize)]
pub struct LoginBody {
    token: String,
}

/// Exchange the server token for the session cookie. The cookie value IS the
/// token (single-user; no session store to expire or leak separately).
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> Response {
    if !token_matches(&state.token, body.token.trim()) {
        return (StatusCode::UNAUTHORIZED, "wrong token").into_response();
    }
    // HttpOnly: page JS never reads it. SameSite=Lax: normal navigation works,
    // cross-site POSTs don't carry it. No Secure flag — localhost/LAN HTTP is
    // the default deployment; TLS termination is the reverse proxy's job.
    let cookie = format!(
        "{COOKIE_NAME}={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000",
        state.token
    );
    ([(header::SET_COOKIE, cookie)], Json(serde_json::json!({ "ok": true }))).into_response()
}

/// Shell detection for the frontend bridge: unauthenticated on purpose so the
/// SPA can decide between "show login" and "no web shell here at all".
pub async fn ping(State(state): State<Arc<AppState>>, req: Request<Body>) -> Response {
    Json(serde_json::json!({
        "app": "apexscience-server",
        "version": env!("CARGO_PKG_VERSION"),
        "authenticated": is_authenticated(&state, &req),
    }))
    .into_response()
}
