use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use nuvo_contracts::{Items, LibraryFlag, PinOrder, SetFlag};
use nuvo_store::{flags, now_ms};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/me/flags", get(list))
        .route("/v1/me/flags/pin-order", post(pin_order))
        .route("/v1/me/flags/{kind}/{id}", put(set).delete(remove))
}

async fn list(State(state): State<AppState>) -> Result<Json<Items<LibraryFlag>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(flags::list).await? }))
}

async fn set(State(state): State<AppState>, Path((kind, id)): Path<(String, String)>, JsonBody(body): JsonBody<SetFlag>) -> Result<Json<LibraryFlag>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| flags::set(c, &kind, &id, &body, now_ms())).await?))
}

async fn remove(State(state): State<AppState>, Path((kind, id)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| flags::delete(c, &kind, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn pin_order(State(state): State<AppState>, JsonBody(body): JsonBody<PinOrder>) -> Result<Json<Items<LibraryFlag>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(move |c| flags::pin_order(c, &body.items)).await? }))
}
