use std::path::PathBuf;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use nuvo_contracts::{DownloadSummary, Items, StartDownload};
use nuvo_store::downloads::{self, NewDownload};
use nuvo_store::now_ms;
use serde::Deserialize;
use serde_json::Value;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::routes::local::{canonical_or_same, refused_target};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/fs/downloads", post(start))
        .route("/v1/downloads", get(list))
        .route("/v1/downloads/{id}", delete(cancel))
        .route("/v1/downloads/waiting", get(waiting))
        .route("/v1/downloads/items/{track_id}/failed", post(failed))
}

async fn start(State(state): State<AppState>, JsonBody(body): JsonBody<StartDownload>) -> Result<(StatusCode, Json<DownloadSummary>), ApiError> {
    let data = state.data()?;
    let format = body.format.clone().unwrap_or_else(|| "original".into());
    if format != "original" && format != "mp3" {
        return Err(ApiError::Invalid("format is original or mp3".into()));
    }
    if format == "mp3" && state.env.find("ffmpeg").is_none() {
        crate::tool_update::request(&state, None);
        return Err(ApiError::Conflict("ffmpeg is still downloading; try MP3 again in a minute".into()));
    }
    let raw = PathBuf::from(&body.dir);
    if !raw.is_absolute() {
        return Err(ApiError::Invalid("dir must be absolute".into()));
    }
    let dir = tokio::fs::canonicalize(&raw).await.map_err(|_| ApiError::Invalid("the folder is gone".into()))?;
    if !tokio::fs::metadata(&dir).await.is_ok_and(|m| m.is_dir()) {
        return Err(ApiError::Invalid("pick a folder".into()));
    }
    let data_dir = canonical_or_same(state.paths.db.parent()).await;
    let cache_dir = canonical_or_same(state.paths.audio.parent()).await;
    if let Some(why) = refused_target(&dir, &[&data_dir, &cache_dir]) {
        return Err(ApiError::Invalid(why.into()));
    }
    let dir = dir.to_str().ok_or_else(|| ApiError::Invalid("the folder name is not valid UTF-8".into()))?.to_string();
    let label = body.label.clone().filter(|l| !l.trim().is_empty()).unwrap_or_else(|| "Nuvo".into());
    let summary = data
        .db
        .call(move |c| {
            let track_ids = downloads::track_ids_for(c, body.playlist_id.as_deref(), body.liked, &body.track_ids)?;
            downloads::create(c, &NewDownload { dir, format, label, playlist_file: body.playlist_file, track_ids }, now_ms())
        })
        .await?;
    crate::downloads::poke(&state);
    Ok((StatusCode::ACCEPTED, Json(summary)))
}

async fn list(State(state): State<AppState>) -> Result<Json<Items<DownloadSummary>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(downloads::list).await? }))
}

async fn cancel(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| downloads::cancel(c, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Limit {
    limit: Option<usize>,
}

async fn waiting(State(state): State<AppState>, Query(q): Query<Limit>) -> Result<Json<Items<Value>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(move |c| downloads::waiting(c, q.limit.unwrap_or(1))).await? }))
}

async fn failed(State(state): State<AppState>, Path(track_id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| downloads::fail_track(c, &track_id, "the track could not be fetched")).await?;
    Ok(StatusCode::NO_CONTENT)
}