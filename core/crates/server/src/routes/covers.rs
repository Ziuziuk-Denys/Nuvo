//! `/v1/covers`: every cover at the size the screen needs, from the encrypted cache, and
//! `DELETE /v1/cache/covers`. Works while locked (memory only, nothing written to disk).

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get};
use axum::Router;
use nuvo_covers::{CoverError, prepare};
use serde::Deserialize;

use crate::error::ApiError;
use crate::state::AppState;

const CACHE_CONTROL: &str = "private, max-age=31536000, immutable";

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/covers", get(cover)).route("/v1/cache/covers", delete(clear))
}

impl From<CoverError> for ApiError {
    fn from(err: CoverError) -> Self {
        match err {
            CoverError::Invalid(m) => ApiError::Invalid(m),
            CoverError::Forbidden(host) => ApiError::Forbidden(host),
            CoverError::NotFound => ApiError::NotFound("cover not found".into()),
            CoverError::Upstream(m) => ApiError::Upstream(m),
            CoverError::Timeout => ApiError::UpstreamTimeout,
        }
    }
}

#[derive(Deserialize)]
struct CoverQuery {
    src: Option<String>,
    size: Option<String>,
    alt: Option<String>,
}

async fn cover(State(state): State<AppState>, Query(q): Query<CoverQuery>, headers: HeaderMap) -> Result<Response, ApiError> {
    // The UI may send a local cover through here like any other; it is served from the file.
    if let Some(id) = q.src.as_deref().and_then(local_cover_id) {
        let bucket = nuvo_covers::source::bucket(q.size.as_deref()).ok_or_else(|| ApiError::Invalid("size must be a number".into()))?;
        return crate::routes::local::local_cover(&state, id, bucket, &headers).await;
    }
    let request = prepare(q.src.as_deref(), q.alt.as_deref(), q.size.as_deref())?;
    // The tag is derived from the cache key, so a matching tag means the renderer has these bytes.
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(request.etag.as_str()) {
        return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, request.etag), (header::CACHE_CONTROL, CACHE_CONTROL.to_string())]).into_response());
    }
    let cover = state.covers.get(&request, state.cover_disk()).await?;
    Response::builder()
        .header(header::CONTENT_TYPE, cover.content_type)
        .header(header::CONTENT_LENGTH, cover.bytes.len())
        .header(header::ETAG, cover.etag)
        .header(header::CACHE_CONTROL, CACHE_CONTROL)
        .body(Body::from(cover.bytes))
        .map_err(|e| ApiError::Internal(e.to_string()))
}

fn local_cover_id(src: &str) -> Option<String> {
    let id = src.strip_prefix(nuvo_local::tags::COVER_BASE)?.strip_suffix("/cover")?;
    (id.starts_with("local:") && !id.contains('/')).then(|| id.to_string())
}

async fn clear(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    state.covers.clear(state.cover_disk().as_ref()).await?;
    Ok(StatusCode::NO_CONTENT)
}
