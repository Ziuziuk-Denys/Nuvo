use axum::body::Bytes;
use axum::extract::rejection::BytesRejection;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use nuvo_contracts::{
    BulkAddResult, BulkTracks, CreatePlaylist, InsertItems, ItemIds, Items, MergePlaylists, MergeResult, MoveItem, OfflineProgress, PlaylistItemsPage, PlaylistListItem,
    PlaylistWithItems, RemoveResult, RestorePlaylists, TrackBody, TransferItems, TransferResult, UpdatePlaylist, UserPlaylist, UserPlaylistItem,
};
use nuvo_store::{now_ms, playlists};
use serde::Deserialize;

use crate::error::ApiError;
use crate::extract::{JsonBody, OptionalJson, body_error};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    const MAX_BULK_BODY: usize = 1024 * 1024;
    Router::new()
        .route("/v1/me/playlists", get(list).post(create))
        .route("/v1/me/playlists/restore", post(restore))
        .route("/v1/me/playlists/{id}/merge", post(merge))
        .route("/v1/me/playlists/{id}", get(detail).patch(update).delete(remove))
        .route("/v1/me/playlists/{id}/items", get(items))
        .route("/v1/me/playlists/{id}/tracks", post(add_many))
        .route("/v1/me/playlists/{id}/tracks/{track_id}", post(add_one))
        .route("/v1/me/playlists/{id}/items/{item_id}", delete(remove_item))
        .route("/v1/me/playlists/{id}/items/{item_id}/move", post(move_item))
        .route("/v1/me/playlists/{id}/cover", get(cover).put(set_cover).delete(remove_cover).layer(DefaultBodyLimit::max(MAX_COVER_BYTES)))
        .route("/v1/me/playlists/{id}/items/remove", post(remove_items).layer(DefaultBodyLimit::max(MAX_BULK_BODY)))
        .route("/v1/me/playlists/{id}/items/transfer", post(transfer_items).layer(DefaultBodyLimit::max(MAX_BULK_BODY)))
        .route("/v1/me/playlists/{id}/items/insert", post(insert_items).layer(DefaultBodyLimit::max(MAX_BULK_BODY)))
        .route("/v1/me/playlists/{id}/offline", get(offline))
}

async fn offline(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<OfflineProgress>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::offline_progress(c, &id)).await?))
}

/// The renderer encodes 600 x 600 WebP at quality 0.86, which stays well below this.
pub const MAX_COVER_BYTES: usize = 400 * 1024;

fn cover_mime(content_type: Option<&str>, bytes: &[u8]) -> Result<&'static str, ApiError> {
    let declared = content_type.unwrap_or_default().split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    let (mime, valid) = match declared.as_str() {
        "image/webp" => ("image/webp", bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"),
        "image/jpeg" => ("image/jpeg", bytes.starts_with(&[0xFF, 0xD8, 0xFF])),
        "image/png" => ("image/png", bytes.starts_with(b"\x89PNG\r\n\x1a\n")),
        _ => return Err(ApiError::Invalid("Content-Type must be image/webp, image/jpeg or image/png".into())),
    };
    if !valid {
        return Err(ApiError::Invalid(format!("body is not a {mime} image")));
    }
    Ok(mime)
}

async fn cover(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    let data = state.data()?;
    let (mime, bytes) = data.db.call(move |c| playlists::cover(c, &id)).await?.ok_or_else(|| ApiError::NotFound("cover not found".into()))?;
    // The URL carries ?v=<updated_at>, so a cached copy can never be stale.
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, mime.parse().unwrap());
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    Ok((headers, bytes).into_response())
}

async fn set_cover(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap, body: Result<Bytes, BytesRejection>) -> Result<Json<UserPlaylist>, ApiError> {
    let body = body.map_err(body_error)?;
    if body.len() > MAX_COVER_BYTES {
        return Err(ApiError::TooLarge);
    }
    let mime = cover_mime(headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()), &body)?;
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::set_cover(c, &id, mime, &body, now_ms())).await?))
}

async fn remove_cover(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| playlists::delete_cover(c, &id, now_ms())).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list(State(state): State<AppState>) -> Result<Json<Items<PlaylistListItem>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(playlists::list_with_covers).await? }))
}

async fn create(State(state): State<AppState>, JsonBody(input): JsonBody<CreatePlaylist>) -> Result<Json<UserPlaylist>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::create(c, &input, now_ms())).await?))
}

#[derive(Deserialize)]
struct DetailQuery {
    limit: Option<usize>,
}

async fn detail(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<DetailQuery>) -> Result<Json<PlaylistWithItems>, ApiError> {
    let data = state.data()?;
    Ok(Json(match q.limit {
        Some(limit) => data.db.call(move |c| playlists::get_head(c, &id, limit)).await?,
        None => data.db.call(move |c| playlists::get(c, &id)).await?,
    }))
}

#[derive(Deserialize)]
struct PageQuery {
    cursor: Option<String>,
    limit: Option<usize>,
    q: Option<String>,
}

async fn items(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<PageQuery>) -> Result<Json<PlaylistItemsPage>, ApiError> {
    let data = state.data()?;
    let limit = q.limit.unwrap_or(playlists::PAGE_DEFAULT);
    Ok(Json(data.db.call(move |c| playlists::items_page(c, &id, q.cursor.as_deref(), limit, q.q.as_deref())).await?))
}

async fn update(State(state): State<AppState>, Path(id): Path<String>, JsonBody(input): JsonBody<UpdatePlaylist>) -> Result<Json<UserPlaylist>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::update(c, &id, &input, now_ms())).await?))
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| playlists::delete(c, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn add_one(
    State(state): State<AppState>,
    Path((id, track_id)): Path<(String, String)>,
    OptionalJson(body): OptionalJson<TrackBody>,
) -> Result<Json<UserPlaylistItem>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::add_track(c, &id, &track_id, body.into_snapshot(), now_ms())).await?))
}

async fn add_many(State(state): State<AppState>, Path(id): Path<String>, JsonBody(body): JsonBody<BulkTracks>) -> Result<Json<BulkAddResult>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::add_tracks(c, &id, body.tracks, now_ms())).await?))
}

async fn remove_item(State(state): State<AppState>, Path((id, item_id)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| playlists::remove_item(c, &id, &item_id, now_ms())).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn move_item(
    State(state): State<AppState>,
    Path((id, item_id)): Path<(String, String)>,
    JsonBody(body): JsonBody<MoveItem>,
) -> Result<Json<PlaylistWithItems>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::move_item(c, &id, &item_id, body.before_item_id.as_deref(), body.revision, now_ms())).await?))
}

async fn remove_items(State(state): State<AppState>, Path(id): Path<String>, JsonBody(body): JsonBody<ItemIds>) -> Result<Json<RemoveResult>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::remove_items(c, &id, &body.item_ids, now_ms())).await?))
}

async fn transfer_items(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<TransferItems>,
) -> Result<Json<TransferResult>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::transfer_items(c, &id, &body.item_ids, &body.target_id, body.mode, now_ms())).await?))
}

async fn insert_items(State(state): State<AppState>, Path(id): Path<String>, JsonBody(body): JsonBody<InsertItems>) -> Result<Json<BulkAddResult>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::insert_items(c, &id, &body.items, now_ms())).await?))
}

async fn merge(State(state): State<AppState>, Path(id): Path<String>, JsonBody(body): JsonBody<MergePlaylists>) -> Result<Json<MergeResult>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| playlists::merge(c, &id, &body, now_ms())).await?))
}

async fn restore(State(state): State<AppState>, JsonBody(body): JsonBody<RestorePlaylists>) -> Result<Json<Items<UserPlaylist>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(move |c| playlists::restore(c, &body.snapshots, now_ms())).await? }))
}
