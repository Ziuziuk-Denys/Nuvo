use std::time::Instant;

use axum::extract::{MatchedPath, Request, State};
use axum::http::header::AUTHORIZATION;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::ApiError;
use crate::state::AppState;

/// Every route, `/health` included, requires the per-launch token Electron main generated.
pub async fn require_token(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let presented = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if !presented.is_some_and(|token| constant_time_eq(token.as_bytes(), state.token.as_bytes())) {
        return ApiError::Unauthorized.into_response();
    }
    let method = req.method().clone();
    // The route template, never the raw path: track ids in URLs would leave a listening history in the log.
    let path = req.extensions().get::<MatchedPath>().map_or("<unmatched>", MatchedPath::as_str).to_string();
    let started = Instant::now();
    let response = next.run(req).await;
    tracing::info!(%method, %path, status = response.status().as_u16(), ms = started.elapsed().as_millis() as u64, "request");
    response
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
