use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use nuvo_contracts::{DailyMixesResponse, MostSavedResponse, PlaybackHistoryResponse, PopularAlbumsResponse, PopularTracksResponse, RecordPlaybackEvent};
use nuvo_store::{events, now_ms, stats};
use serde::Deserialize;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::scrobbler;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/me/playback/events", post(record))
        .route("/v1/me/history", get(history))
        .route("/v1/me/recommendations/daily-mixes", get(daily_mixes))
        .route("/v1/explore/popular", get(popular))
        .route("/v1/explore/popular/albums", get(popular_albums))
        .route("/v1/explore/most-saved", get(most_saved))
        .route("/v1/tracks/{id}/radio", get(radio).post(radio))
}

#[derive(Deserialize)]
struct HistoryQuery {
    limit: Option<usize>,
    cursor: Option<String>,
    filter: Option<String>,
}

#[derive(Deserialize)]
struct WindowQuery {
    window: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct SavedQuery {
    #[serde(rename = "type")]
    kind: Option<String>,
    limit: Option<usize>,
}

async fn record(State(state): State<AppState>, JsonBody(event): JsonBody<RecordPlaybackEvent>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    if data.db.call(move |c| {
        let now = now_ms();
        let recorded = events::record(c, &event, now)?;
        // Recommendations learn once per play; a failure there must never lose the play itself.
        if recorded.is_new
            && let Err(err) = nuvo_recs::feedback::after_play(c, &event, now)
        {
            tracing::warn!(%err, "recommendation feedback failed");
        }
        Ok(recorded.queued)
    }).await? {
        scrobbler::spawn_flush(&state);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn history(State(state): State<AppState>, Query(q): Query<HistoryQuery>) -> Result<Json<PlaybackHistoryResponse>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| events::history(c, q.limit.unwrap_or(30), q.cursor.as_deref(), q.filter.as_deref())).await?))
}

async fn daily_mixes(State(state): State<AppState>) -> Result<Json<DailyMixesResponse>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(|c| nuvo_recs::mixes::daily_mixes(c, now_ms())).await?))
}

async fn popular(State(state): State<AppState>, Query(q): Query<WindowQuery>) -> Result<Json<PopularTracksResponse>, ApiError> {
    let data = state.data()?;
    let window = q.window.unwrap_or_else(|| "7d".into());
    Ok(Json(data.db.call(move |c| stats::popular_tracks(c, &window, q.limit.unwrap_or(50), now_ms())).await?))
}

async fn popular_albums(State(state): State<AppState>, Query(q): Query<WindowQuery>) -> Result<Json<PopularAlbumsResponse>, ApiError> {
    let data = state.data()?;
    let window = q.window.unwrap_or_else(|| "7d".into());
    Ok(Json(data.db.call(move |c| stats::popular_albums(c, &window, q.limit.unwrap_or(20), now_ms())).await?))
}

async fn most_saved(State(state): State<AppState>, Query(q): Query<SavedQuery>) -> Result<Json<MostSavedResponse>, ApiError> {
    let data = state.data()?;
    let kind = q.kind.unwrap_or_else(|| "all".into());
    Ok(Json(data.db.call(move |c| stats::most_saved(c, &kind, q.limit.unwrap_or(20))).await?))
}

/// Radio stays client-side (InnerTube) until sub-project 2; 404 makes the renderer keep its own result.
async fn radio(State(state): State<AppState>, Path(_id): Path<String>) -> Result<StatusCode, ApiError> {
    state.data()?;
    Err(ApiError::NotFound("server radio is not available".into()))
}
