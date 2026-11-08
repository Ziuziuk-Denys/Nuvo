use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use nuvo_contracts::{AddSearch, Items, SearchEntry};
use nuvo_store::{now_ms, search_history};
use serde::Deserialize;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/me/search-history", get(list).post(add).delete(clear))
        .route("/v1/me/search-history/{id}", delete(remove))
}

#[derive(Deserialize)]
struct Limit {
    limit: Option<usize>,
}

async fn list(State(state): State<AppState>, Query(q): Query<Limit>) -> Result<Json<Items<SearchEntry>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(move |c| search_history::list(c, q.limit.unwrap_or(30))).await? }))
}

async fn add(State(state): State<AppState>, JsonBody(body): JsonBody<AddSearch>) -> Result<Json<SearchEntry>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| search_history::add(c, &body, now_ms())).await?))
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| search_history::delete(c, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(search_history::clear).await?;
    Ok(StatusCode::NO_CONTENT)
}
