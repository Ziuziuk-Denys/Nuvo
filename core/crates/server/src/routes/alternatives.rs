//! `/v1/tracks/{id}/alternative`: the fallback choice the player remembers per track. Like the
//! matching routes, a locked library answers "nothing remembered" instead of failing.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use nuvo_contracts::MAX_TRACK_ID_LEN;
use nuvo_store::alternatives::{self, Alternative};
use nuvo_store::now_ms;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

const MAX_REASON_LEN: usize = 64;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/tracks/{id}/alternative", get(read).put(write))
        .route("/v1/tracks/{id}/alternative/reject", post(reject))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlternativeBody {
    source: String,
    alt_id: String,
    score: f64,
    reason: String,
    #[serde(default)]
    duration_ms: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AlternativeReply {
    source: String,
    alt_id: String,
    score: i64,
    reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RejectBody {
    alt_id: String,
}

fn check_id(id: &str, what: &str) -> Result<(), ApiError> {
    if id.is_empty() || id.len() > MAX_TRACK_ID_LEN {
        return Err(ApiError::Invalid(format!("bad {what}")));
    }
    Ok(())
}

fn validate(body: AlternativeBody) -> Result<Alternative, ApiError> {
    if body.source != "youtube" && body.source != "soundcloud" {
        return Err(ApiError::Invalid("source must be youtube or soundcloud".into()));
    }
    check_id(&body.alt_id, "alternative id")?;
    if !(0.0..=100.0).contains(&body.score) {
        return Err(ApiError::Invalid("score must be between 0 and 100".into()));
    }
    if body.reason.trim().is_empty() || body.reason.len() > MAX_REASON_LEN {
        return Err(ApiError::Invalid("bad reason".into()));
    }
    Ok(Alternative {
        source: body.source,
        alt_id: body.alt_id,
        score: body.score.round() as i64,
        reason: body.reason,
        duration_ms: body.duration_ms.filter(|ms| ms.is_finite() && *ms > 0.0).map(|ms| ms.round() as i64),
    })
}

async fn read(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    check_id(&id, "track id")?;
    let Ok(data) = state.data() else { return Ok(StatusCode::NO_CONTENT.into_response()) };
    let Some(alt) = data.db.call(move |c| alternatives::get(c, &id)).await? else { return Ok(StatusCode::NO_CONTENT.into_response()) };
    let body = AlternativeReply { source: alt.source, alt_id: alt.alt_id, score: alt.score, reason: alt.reason, duration_ms: alt.duration_ms };
    Ok(Json(body).into_response())
}

async fn write(State(state): State<AppState>, Path(id): Path<String>, JsonBody(body): JsonBody<AlternativeBody>) -> Result<StatusCode, ApiError> {
    check_id(&id, "track id")?;
    let alt = validate(body)?;
    if state.is_starting() {
        return Err(ApiError::Starting);
    }
    if let Ok(data) = state.data() {
        data.db.call(move |c| alternatives::put(c, &id, &alt, now_ms())).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn reject(State(state): State<AppState>, Path(id): Path<String>, JsonBody(body): JsonBody<RejectBody>) -> Result<StatusCode, ApiError> {
    check_id(&id, "track id")?;
    check_id(&body.alt_id, "alternative id")?;
    if state.is_starting() {
        return Err(ApiError::Starting);
    }
    if let Ok(data) = state.data() {
        data.db.call(move |c| alternatives::reject(c, &id, &body.alt_id)).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}
