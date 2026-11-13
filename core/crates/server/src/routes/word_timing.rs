use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use nuvo_contracts::{MAX_TRACK_ID_LEN, SetWordTiming, StartWordTiming, WordTiming, WordTimingJob};
use nuvo_fetch::update::{WHISPER_BASE, WHISPER_SMALL};
use nuvo_store::settings;
use serde_json::Value;

use crate::error::ApiError;
use crate::extract::{JsonBody, OptionalJson};
use crate::state::{AppState, Unlocked};
use crate::word_timing;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/lyrics/word-timing", get(view).put(set))
        .route("/v1/tracks/{id}/lyrics/word-timing", post(start).delete(cancel))
}

pub async fn enabled(data: &Unlocked) -> Result<bool, ApiError> {
    let stored = data.db.call(|c| settings::get(c, settings::LYRICS_WORD_TIMING)).await?;
    Ok(stored.as_ref().and_then(Value::as_bool).unwrap_or(false))
}

async fn current(state: &AppState, data: &Unlocked) -> Result<WordTiming, ApiError> {
    Ok(WordTiming { enabled: enabled(data).await?, models: word_timing::installed(state), job: state.word_timing.current() })
}

async fn view(State(state): State<AppState>) -> Result<Json<WordTiming>, ApiError> {
    let data = state.data()?;
    Ok(Json(current(&state, &data).await?))
}

async fn set(State(state): State<AppState>, JsonBody(body): JsonBody<SetWordTiming>) -> Result<Json<WordTiming>, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| settings::set(c, settings::LYRICS_WORD_TIMING, &Value::Bool(body.enabled))).await?;
    if !body.enabled {
        state.word_timing.cancel(None);
    }
    Ok(Json(current(&state, &data).await?))
}

fn check_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty() || id.len() > MAX_TRACK_ID_LEN {
        return Err(ApiError::Invalid(format!("track id must be 1 to {MAX_TRACK_ID_LEN} bytes")));
    }
    Ok(())
}

async fn start(State(state): State<AppState>, Path(id): Path<String>, OptionalJson(body): OptionalJson<StartWordTiming>) -> Result<(StatusCode, Json<WordTimingJob>), ApiError> {
    check_id(&id)?;
    let data = state.data()?;
    if !enabled(&data).await? {
        return Err(ApiError::Conflict("word timing is off".into()));
    }
    let job = word_timing::start(&state, data, id, if body.best { &WHISPER_SMALL } else { &WHISPER_BASE });
    Ok((StatusCode::ACCEPTED, Json(job)))
}

async fn cancel(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    check_id(&id)?;
    state.word_timing.cancel(Some(&id));
    Ok(StatusCode::NO_CONTENT)
}
