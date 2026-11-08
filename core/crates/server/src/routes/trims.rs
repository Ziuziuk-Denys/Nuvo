use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use nuvo_contracts::{Items, SetTrim, TrackTrim};
use nuvo_store::{now_ms, trims};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/me/trims", get(list))
        .route("/v1/tracks/{id}/trim", get(read).put(write).delete(remove))
}

async fn list(State(state): State<AppState>) -> Result<Json<Items<TrackTrim>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(trims::list).await? }))
}

async fn read(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<TrackTrim>, ApiError> {
    let data = state.data()?;
    let trim = data.db.call(move |c| trims::get(c, &id)).await?;
    Ok(Json(trim.ok_or_else(|| ApiError::NotFound("trim not found".into()))?))
}

async fn write(State(state): State<AppState>, Path(id): Path<String>, JsonBody(body): JsonBody<SetTrim>) -> Result<Json<TrackTrim>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| trims::set(c, &id, &body, now_ms())).await?))
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| trims::delete(c, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}
