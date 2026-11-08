use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post, put};
use axum::{Json, Router};
use nuvo_contracts::{BulkLikeResult, BulkTracks, Items, LikedTracksPage, PublicUser, RemovedCount, SnapshotBody, TrackBody, TrackIds, UpdateProfile};
use nuvo_match::{LikedIndex, same_song};
use nuvo_store::library::{self, SavedKind};
use nuvo_store::{now_ms, settings};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::{JsonBody, OptionalJson};
use crate::state::AppState;

const DEFAULT_DISPLAY_NAME: &str = "Me";
const MAX_DISPLAY_NAME_CHARS: usize = 100;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/me", get(me))
        .route("/v1/users/me", patch(update_me))
        .route("/v1/me/library/tracks", get(liked))
        .route("/v1/me/library/track-ids", get(liked_ids))
        .route("/v1/me/library/tracks/bulk", post(like_many))
        .route("/v1/me/library/tracks/bulk-remove", post(unlike_many))
        .route("/v1/me/library/tracks/{id}", put(like).delete(unlike))
        .route("/v1/me/library/{kind}", get(saved))
        .route("/v1/me/library/{kind}/{id}", put(save).delete(remove))
}

#[derive(Deserialize)]
pub struct PageQuery {
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

async fn profile(state: &AppState) -> Result<PublicUser, ApiError> {
    let data = state.data()?;
    let stored = data.db.call(|c| settings::get(c, settings::DISPLAY_NAME)).await?;
    let display_name = stored.and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| DEFAULT_DISPLAY_NAME.into());
    Ok(PublicUser { id: "local", username: "me", display_name })
}

async fn me(State(state): State<AppState>) -> Result<Json<PublicUser>, ApiError> {
    Ok(Json(profile(&state).await?))
}

async fn update_me(State(state): State<AppState>, JsonBody(body): JsonBody<UpdateProfile>) -> Result<Json<PublicUser>, ApiError> {
    if let Some(name) = body.display_name {
        let value = match name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
            Some(n) if n.chars().count() > MAX_DISPLAY_NAME_CHARS => {
                return Err(ApiError::Invalid(format!("display name is longer than {MAX_DISPLAY_NAME_CHARS} characters")));
            }
            Some(n) => json!(n),
            None => Value::Null,
        };
        let data = state.data()?;
        data.db.call(move |c| settings::set(c, settings::DISPLAY_NAME, &value)).await?;
    }
    Ok(Json(profile(&state).await?))
}

async fn liked(State(state): State<AppState>, Query(q): Query<PageQuery>) -> Result<Json<LikedTracksPage>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| library::liked_page(c, q.limit.unwrap_or(100), q.cursor.as_deref())).await?))
}

async fn like(State(state): State<AppState>, Path(id): Path<String>, OptionalJson(body): OptionalJson<TrackBody>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    let snapshot = body.into_snapshot();
    data.db
        .call(move |c| {
            // The single and its album copy are one song: the newest like stands for both.
            if let Some(new) = snapshot.as_ref() {
                for (other, old) in library::liked_snapshots(c)? {
                    if other != id && same_song(new, &old) {
                        library::unlike(c, &other)?;
                    }
                }
            }
            library::like(c, &id, snapshot, now_ms())
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Bulk like that leaves a song's twin alone: the copy already liked (or earlier in the batch)
/// stands, and the later one counts as already liked.
fn like_many_distinct(conn: &nuvo_store::Connection, snapshots: &[Value], now: i64) -> Result<BulkLikeResult, nuvo_store::StoreError> {
    let mut index = LikedIndex::load(conn)?;
    let mut kept = Vec::with_capacity(snapshots.len());
    let mut twins = 0;
    for snapshot in snapshots {
        let id = snapshot["id"].as_str().unwrap_or_default();
        if !id.is_empty() && index.has_twin(id, snapshot) {
            twins += 1;
            continue;
        }
        if !id.is_empty() {
            index.add(id.to_string(), snapshot.clone());
        }
        kept.push(snapshot.clone());
    }
    let mut result = library::like_many(conn, &kept, now)?;
    result.already_liked += twins;
    Ok(result)
}

async fn like_many(State(state): State<AppState>, JsonBody(body): JsonBody<BulkTracks>) -> Result<Json<BulkLikeResult>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| like_many_distinct(c, &body.tracks, now_ms())).await?))
}

/// Used only by the undo of a bulk like, with that request's `added` ids.
async fn unlike_many(State(state): State<AppState>, JsonBody(body): JsonBody<TrackIds>) -> Result<Json<RemovedCount>, ApiError> {
    let data = state.data()?;
    Ok(Json(RemovedCount { removed: data.db.call(move |c| library::unlike_many(c, &body.ids)).await? }))
}

async fn unlike(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| library::unlike(c, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn kind(plural: &str) -> Result<SavedKind, ApiError> {
    SavedKind::from_plural(plural).ok_or_else(|| ApiError::NotFound(format!("unknown library collection {plural}")))
}

async fn saved(State(state): State<AppState>, Path(plural): Path<String>) -> Result<Json<Items<Value>>, ApiError> {
    let kind = kind(&plural)?;
    let data = state.data()?;
    let items = data.db.call(move |c| library::list_saved(c, kind)).await?;
    Ok(Json(Items { items }))
}

async fn save(
    State(state): State<AppState>,
    Path((plural, id)): Path<(String, String)>,
    OptionalJson(body): OptionalJson<SnapshotBody>,
) -> Result<StatusCode, ApiError> {
    let kind = kind(&plural)?;
    let data = state.data()?;
    data.db.call(move |c| library::save_item(c, kind, &id, body.snapshot, now_ms())).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(State(state): State<AppState>, Path((plural, id)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let kind = kind(&plural)?;
    let data = state.data()?;
    data.db.call(move |c| library::remove_item(c, kind, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Serialize)]
struct LikedIds {
    ids: Vec<String>,
}

async fn liked_ids(State(state): State<AppState>) -> Result<Json<LikedIds>, ApiError> {
    let data = state.data()?;
    Ok(Json(LikedIds { ids: data.db.call(library::liked_ids).await? }))
}
