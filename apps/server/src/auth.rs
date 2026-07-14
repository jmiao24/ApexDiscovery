// Single-user session auth: POST /api/login exchanges the server token for an
// HttpOnly cookie; everything under /api (except login/ping) and /runtime
// requires it. `Authorization: Bearer <token>` also works for programmatic use.
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
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
    session_cookie_value(req).is_some_and(|t| token_matches(&state.session_token, &t))
        || bearer_value(req).is_some_and(|t| token_matches(&state.access_token, &t))
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

/// Exchange the operator access token for a separate browser-session cookie.
pub async fn login(State(state): State<Arc<AppState>>, Json(body): Json<LoginBody>) -> Response {
    if !token_matches(&state.access_token, body.token.trim()) {
        return (StatusCode::UNAUTHORIZED, "wrong token").into_response();
    }
    let cookie = session_cookie(&state);
    (
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}

#[derive(serde::Deserialize)]
pub struct BootstrapQuery {
    nonce: String,
}

fn session_cookie(state: &AppState) -> String {
    // Browser-session lifetime: restarting either the server or browser
    // requires a fresh one-time bootstrap. Secure cannot be used on plain
    // loopback HTTP; HttpOnly + SameSite=Strict keep JS and cross-site requests
    // from reading/sending the cookie.
    format!(
        "{COOKIE_NAME}={}; HttpOnly; SameSite=Strict; Path=/",
        state.session_token
    )
}

/// One-time localhost bootstrap: the launcher opens this URL, the server
/// exchanges the nonce for an HttpOnly session cookie, then removes the nonce
/// from browser history with a redirect to `/`.
pub async fn bootstrap(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BootstrapQuery>,
) -> Response {
    let mut expected = state.bootstrap_nonce.lock().await;
    let valid = expected
        .as_deref()
        .is_some_and(|nonce| token_matches(nonce, query.nonce.trim()));
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            "invalid or expired bootstrap nonce",
        )
            .into_response();
    }
    *expected = None;
    (
        StatusCode::SEE_OTHER,
        [
            (header::SET_COOKIE, session_cookie(&state)),
            (header::LOCATION, "/".to_string()),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
    )
        .into_response()
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

#[cfg(test)]
mod tests {
    use super::*;
    use shell_core::ShellCtx;
    use std::path::PathBuf;

    fn state(nonce: &str) -> Arc<AppState> {
        Arc::new(AppState::new(
            ShellCtx {
                data_dir: std::env::temp_dir().join("apex-auth-test"),
                document_dir: None,
                resource_dir: None,
                app_version: "test".to_string(),
            },
            "manual-token".to_string(),
            Some(nonce.to_string()),
            PathBuf::from("unused-sidecar"),
        ))
    }

    #[tokio::test]
    async fn bootstrap_nonce_is_single_use_and_sets_a_separate_cookie() {
        let state = state("one-time");
        let first = bootstrap(
            State(state.clone()),
            Query(BootstrapQuery {
                nonce: "one-time".to_string(),
            }),
        )
        .await;
        assert_eq!(first.status(), StatusCode::SEE_OTHER);
        let cookie = first.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
        assert!(cookie.contains(&state.session_token));
        assert!(!cookie.contains("one-time"));
        assert!(!cookie.contains("manual-token"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Strict"));

        let replay = bootstrap(
            State(state),
            Query(BootstrapQuery {
                nonce: "one-time".to_string(),
            }),
        )
        .await;
        assert_eq!(replay.status(), StatusCode::UNAUTHORIZED);
    }
}
