use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use nuvo_contracts::{ExcludedItem, Items, NotInterestedRequest, NotInterestedResult, PoolRequest, RankRequest, RankResponse, SeedsResponse, SuppressionItem};
use nuvo_crypto::random_bytes;
use nuvo_match::{Answer, Candidate, Reason, Source};
use nuvo_recs::{pool, rank, rewards, starters, suppress};
use nuvo_soundcloud::{SoundCloud, map};
use nuvo_store::{alternatives, now_ms, tracks};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/recs/rank", post(rank_batch))
        .route("/v1/recs/seeds", get(seeds))
        .route("/v1/recs/pool", put(replace_pool))
        .route("/v1/recs/pool/sc-related", post(sc_related))
        .route("/v1/recs/start", get(start))
        .route("/v1/recs/starters", put(save_starters))
        .route("/v1/recs/not-interested", post(not_interested))
        .route("/v1/recs/suppressions", get(suppressions))
        .route("/v1/recs/suppressions/{id}", delete(remove_suppression))
        .route("/v1/recs/excluded", get(excluded))
        .route("/v1/recs/excluded/{kind}/{id}", put(exclude).delete(include))
}

async fn rank_batch(State(state): State<AppState>, JsonBody(req): JsonBody<RankRequest>) -> Result<Json<RankResponse>, ApiError> {
    let data = state.data()?;
    let seed = u64::from_le_bytes(random_bytes::<8>());
    Ok(Json(data.db.call(move |c| rank::rank(c, &req, now_ms(), seed)).await?))
}

#[derive(Deserialize)]
struct SeedsQuery {
    source: Option<String>,
}

async fn seeds(State(state): State<AppState>, Query(q): Query<SeedsQuery>) -> Result<Json<SeedsResponse>, ApiError> {
    let data = state.data()?;
    let source = q.source.unwrap_or_else(|| pool::YT_RADIO.to_string());
    let seeds = data.db.call(move |c| pool::stale_seeds(c, now_ms(), &source)).await?;
    Ok(Json(SeedsResponse { seeds }))
}

async fn replace_pool(State(state): State<AppState>, JsonBody(req): JsonBody<PoolRequest>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| pool::replace(c, &req.seed_id, &req.source, &req.items, now_ms())).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn not_interested(State(state): State<AppState>, JsonBody(req): JsonBody<NotInterestedRequest>) -> Result<Json<NotInterestedResult>, ApiError> {
    let data = state.data()?;
    let result = data
        .db
        .call(move |c| {
            let now = now_ms();
            tracks::ensure(c, &req.track_id, req.track.as_ref(), now)?;
            suppress::not_interested(c, &req.track_id, &req.scope, now)
        })
        .await?;
    Ok(Json(result))
}

async fn suppressions(State(state): State<AppState>) -> Result<Json<Items<SuppressionItem>>, ApiError> {
    let data = state.data()?;
    let items = data.db.call(|c| suppress::list(c, now_ms())).await?;
    Ok(Json(Items { items }))
}

async fn remove_suppression(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let id: i64 = id.parse().map_err(|_| ApiError::NotFound("suppression not found".into()))?;
    let data = state.data()?;
    data.db.call(move |c| suppress::delete(c, id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn excluded(State(state): State<AppState>) -> Result<Json<Items<ExcludedItem>>, ApiError> {
    let data = state.data()?;
    let rows = data.db.call(rewards::excluded).await?;
    Ok(Json(Items { items: rows.into_iter().map(|(kind, id)| ExcludedItem { kind, id }).collect() }))
}

async fn exclude(State(state): State<AppState>, Path((kind, id)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| rewards::set_excluded(c, &kind, &id, true)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn include(State(state): State<AppState>, Path((kind, id)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| rewards::set_excluded(c, &kind, &id, false)).await?;
    Ok(StatusCode::NO_CONTENT)
}

const SC_SEARCH_LIMIT: usize = 20;
const SC_RELATED_LIMIT: usize = 50;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScRelatedBody {
    seed_id: String,
}

#[derive(Serialize)]
struct ScRelatedReply {
    stored: usize,
}

async fn sc_related(State(state): State<AppState>, JsonBody(body): JsonBody<ScRelatedBody>) -> Result<Json<ScRelatedReply>, ApiError> {
    let data = state.data()?;
    let seed = body.seed_id;
    let lookup = seed.clone();
    let (snapshot, alternative) = data.db.call(move |c| Ok((tracks::snapshot(c, &lookup)?, alternatives::get(c, &lookup)?))).await?;
    let snapshot = snapshot.ok_or_else(|| ApiError::NotFound("track not found".into()))?;
    let sc = state.soundcloud().await;
    let upload = if seed.starts_with("sc:") {
        Some(seed.clone())
    } else if let Some(alternative) = alternative.filter(|a| a.source == "soundcloud") {
        Some(alternative.alt_id)
    } else {
        soundcloud_upload(sc, &snapshot).await?
    };
    let items: Vec<Value> = match upload {
        // A failed read is an outage (an error status, nothing stored, seed stays due), not an empty list.
        Some(id) => sc.try_related(&id, SC_RELATED_LIMIT).await?.iter().filter_map(|t| serde_json::to_value(t).ok()).collect(),
        None => Vec::new(),
    };
    let stored = data.db.call(move |c| pool::replace(c, &seed, pool::SC_RELATED, &items, now_ms())).await?;
    Ok(Json(ScRelatedReply { stored }))
}

async fn soundcloud_upload(sc: &SoundCloud, snapshot: &Value) -> Result<Option<String>, ApiError> {
    let Some(known) = Candidate::from_track(snapshot) else { return Ok(None) };
    let source = Source { title: known.title, artists: known.artists, duration_ms: known.duration_ms };
    let answer = nuvo_match::run(&source, |query, _filter| async move {
        let records = sc.search_tracks(&query, SC_SEARCH_LIMIT).await.map_err(|err| err.to_string())?;
        Ok(records.iter().filter_map(map::track).filter_map(|t| serde_json::to_value(t).ok()).collect())
    })
    .await
    .map_err(ApiError::Invalid)?;
    match answer {
        Answer::Approved { track, .. } => Ok(track.get("id").and_then(Value::as_str).map(str::to_string)),
        Answer::Pending { reason: Reason::LookupFailed, .. } => Err(ApiError::ScUnavailable),
        _ => Ok(None),
    }
}

#[derive(Serialize)]
struct StartReply {
    needed: bool,
}

#[derive(Deserialize)]
struct StartersBody {
    tracks: Vec<Value>,
}

async fn start(State(state): State<AppState>) -> Result<Json<StartReply>, ApiError> {
    let data = state.data()?;
    let needed = data.db.call(starters::needed).await?;
    Ok(Json(StartReply { needed }))
}

async fn save_starters(State(state): State<AppState>, JsonBody(body): JsonBody<StartersBody>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| starters::replace(c, &body.tracks, now_ms())).await?;
    Ok(StatusCode::NO_CONTENT)
}
