use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use futures::StreamExt;
use nuvo_cache::CacheError;
use nuvo_contracts::{CacheSettings, CacheStatus, CoverStats, FetchRequest, FetchStatus, Items, MAX_TRACK_ID_LEN};
use nuvo_covers::index as cover_index;
use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_store::{Connection, StoreError, now_ms, settings};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::precache;
use crate::state::{AppState, Unlocked};

pub const DEFAULT_LIMIT_BYTES: i64 = 5 * 1024 * 1024 * 1024;
const MIN_LIMIT_BYTES: i64 = 256 * 1024 * 1024;
pub const MAX_UPLOAD_BYTES: u64 = 512 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/cache/audio", axum::routing::delete(clear))
        .route("/v1/cache/audio/{id}", get(read).put(write).delete(remove))
        .route("/v1/cache/status", get(status))
        .route("/v1/cache/settings", patch(update_settings))
        .route("/v1/cache/missing", get(missing))
        .route("/v1/cache/fetch", post(fetch))
        .route("/v1/cache/fetch/{id}", get(fetch_status).delete(cancel_fetch))
}

/// `0` means unlimited, matching the renderer's existing cache setting.
fn limit_bytes(conn: &Connection) -> Result<i64, StoreError> {
    let limit = settings::get(conn, settings::CACHE_LIMIT_BYTES)?.and_then(|v| v.as_i64()).unwrap_or(DEFAULT_LIMIT_BYTES);
    Ok(if limit == 0 { i64::MAX } else { limit })
}

fn check_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty() || id.len() > MAX_TRACK_ID_LEN {
        return Err(ApiError::Invalid("bad track id".into()));
    }
    Ok(())
}

#[derive(Debug, PartialEq)]
pub struct Unsatisfiable;

pub fn parse_range(value: &str, size: u64) -> Result<Option<(u64, u64)>, Unsatisfiable> {
    if size == 0 {
        return Err(Unsatisfiable);
    }
    let Some(spec) = value.trim().strip_prefix("bytes=") else { return Ok(None) };
    if spec.contains(',') {
        return Ok(None);
    }
    let Some((start, end)) = spec.split_once('-') else { return Ok(None) };
    let (start, end) = match (start.trim(), end.trim()) {
        ("", "") => return Ok(None),
        ("", suffix) => {
            if !suffix.chars().all(|c| c.is_ascii_digit()) {
                return Ok(None);
            }
            let Ok(n) = suffix.parse::<u64>() else { return Ok(None) };
            if n == 0 {
                return Err(Unsatisfiable);
            }
            (size.saturating_sub(n), size - 1)
        }
        (start, end) => {
            if !start.chars().all(|c| c.is_ascii_digit()) {
                return Ok(None);
            }
            let Ok(start) = start.parse::<u64>() else { return Ok(None) };
            let end = if end.is_empty() {
                size - 1
            } else {
                if !end.chars().all(|c| c.is_ascii_digit()) {
                    return Ok(None);
                }
                let Ok(end) = end.parse::<u64>() else { return Ok(None) };
                end.min(size - 1)
            };
            (start, end)
        }
    };
    if start >= size || start > end {
        return Err(Unsatisfiable);
    }
    Ok(Some((start, end)))
}

async fn read(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> Result<Response, ApiError> {
    serve(&state.data()?, id, &headers).await
}

pub(crate) async fn serve(data: &Unlocked, id: String, headers: &HeaderMap) -> Result<Response, ApiError> {
    let lookup = id.clone();
    let entry = data.db.call(move |c| cache_index::get(c, &lookup)).await?.ok_or_else(|| ApiError::NotFound("audio is not cached".into()))?;
    let Some(size) = data.cache.size(&id).await? else {
        forget(data, &id).await?;
        return Err(ApiError::NotFound("audio is not cached".into()));
    };
    if size == 0 {
        forget(data, &id).await?;
        return Err(ApiError::NotFound("audio is not cached".into()));
    }
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).map_or(Ok(None), |v| parse_range(v, size));
    let (status, start, end) = match range {
        Ok(None) => (StatusCode::OK, 0, size - 1),
        Ok(Some((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end),
        Err(Unsatisfiable) => {
            let content_range = HeaderValue::from_str(&format!("bytes */{size}")).expect("ascii header");
            return Ok((StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, content_range)]).into_response());
        }
    };
    // shortcut: buffers the whole range to be streamed later
    let bytes = match data.cache.read_range(&id, start, end).await {
        Ok(bytes) => bytes,
        // A damaged file is dropped so the player falls back to the network instead of failing.
        Err(CacheError::Corrupt) => {
            tracing::warn!("dropping corrupt cache file");
            forget(data, &id).await?;
            return Err(ApiError::NotFound("audio is not cached".into()));
        }
        Err(err) => return Err(err.into()),
    };
    data.db.call(move |c| cache_index::touch(c, &id, now_ms())).await?;
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, entry.mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, bytes.len());
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    if let Some(codec) = entry.codec {
        response = response.header("x-nuvo-codec", codec);
    }
    response.body(Body::from(bytes)).map_err(|e| ApiError::Internal(e.to_string()))
}

async fn write(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap, body: Body) -> Result<StatusCode, ApiError> {
    check_id(&id)?;
    let data = state.data()?;
    let header_text = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let content_type = header_text("content-type").ok_or_else(|| ApiError::Invalid("Content-Type must be audio/* or video/*".into()))?;
    let mime = content_type.to_lowercase();
    if !mime.starts_with("audio/") && !mime.starts_with("video/") {
        return Err(ApiError::Invalid("Content-Type must be audio/* or video/*".into()));
    }
    if let Some(content_len) = headers.get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<u64>().ok())
        && content_len > MAX_UPLOAD_BYTES
    {
        return Err(ApiError::TooLarge);
    }
    let codec = header_text("x-nuvo-codec").filter(|c| c.len() <= 64);

    let mut writer = data.cache.begin(&id).await?;
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => {
                writer.abort().await;
                return Err(ApiError::Invalid(format!("upload interrupted: {err}")));
            }
        };
        if writer.size() + chunk.len() as u64 > MAX_UPLOAD_BYTES {
            writer.abort().await;
            return Err(ApiError::TooLarge);
        }
        match writer.write(&chunk).await {
            Ok(_) => {}
            Err(err) => {
                writer.abort().await;
                return Err(err.into());
            }
        }
    }
    let finished = match writer.finish().await {
        Ok(f) => f,
        Err(err) => return Err(err.into()),
    };
    let entry = CacheEntry { track_id: id.clone(), path: finished.path.to_string_lossy().into_owned(), size_bytes: finished.size as i64, mime, codec };
    data.db.call(move |c| cache_index::upsert(c, &entry, now_ms())).await?;
    crate::downloads::poke(&state);
    if let Err(e) = evict(&data, Some(&id)).await {
        tracing::warn!("cache eviction failed: {:?}", e);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn forget(data: &Unlocked, id: &str) -> Result<(), ApiError> {
    data.cache.delete(id).await?;
    let id = id.to_string();
    data.db.call(move |c| cache_index::delete(c, &id)).await?;
    Ok(())
}

pub(crate) async fn evict(data: &Unlocked, protected_id: Option<&str>) -> Result<(), ApiError> {
    let now = now_ms();
    let (limit, mut total, victims) = data
        .db
        .call(move |c| Ok((limit_bytes(c)?, cache_index::total_bytes(c)?, cache_index::eviction_candidates(c, now)?)))
        .await?;
    for victim in victims {
        if total <= limit {
            break;
        }
        if Some(victim.track_id.as_str()) == protected_id {
            continue;
        }
        forget(data, &victim.track_id).await?;
        total -= victim.size_bytes;
    }
    Ok(())
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    forget(&data, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    for entry in data.db.call(cache_index::all).await? {
        forget(&data, &entry.track_id).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn cache_status(data: &Unlocked) -> Result<CacheStatus, ApiError> {
    let now = now_ms();
    Ok(data
        .db
        .call(move |c| {
            let stored = settings::get(c, settings::CACHE_LIMIT_BYTES)?.and_then(|v| v.as_i64()).unwrap_or(DEFAULT_LIMIT_BYTES);
            let mut status = cache_index::status(c, now, stored)?;
            let (bytes, count) = cover_index::totals(c)?;
            status.covers = CoverStats { bytes, count, limit_bytes: cover_index::stored_limit(c)? };
            Ok(status)
        })
        .await?)
}

async fn status(State(state): State<AppState>) -> Result<Json<CacheStatus>, ApiError> {
    Ok(Json(cache_status(&state.data()?).await?))
}

fn limit_value(value: i64, min: i64, name: &str) -> Result<i64, ApiError> {
    if value < 0 {
        return Err(ApiError::Invalid(format!("{name} must not be negative")));
    }
    Ok(if value == 0 { 0 } else { value.max(min) })
}

async fn update_settings(State(state): State<AppState>, JsonBody(body): JsonBody<CacheSettings>) -> Result<Json<CacheStatus>, ApiError> {
    if body.limit_bytes.is_none() && body.covers_limit_bytes.is_none() {
        return Err(ApiError::Invalid("send limitBytes or coversLimitBytes".into()));
    }
    let audio = body.limit_bytes.map(|v| limit_value(v, MIN_LIMIT_BYTES, "limitBytes")).transpose()?;
    let covers = body.covers_limit_bytes.map(|v| limit_value(v, cover_index::MIN_LIMIT_BYTES, "coversLimitBytes")).transpose()?;
    let data = state.data()?;
    if let Some(limit) = audio {
        data.db.call(move |c| settings::set(c, settings::CACHE_LIMIT_BYTES, &json!(limit))).await?;
        evict(&data, None).await?;
    }
    if let Some(limit) = covers {
        data.db.call(move |c| settings::set(c, cover_index::LIMIT_KEY, &json!(limit))).await?;
        let disk = nuvo_covers::Disk { db: data.db.clone(), files: data.cover_files.clone() };
        if let Err(err) = nuvo_covers::evict(&disk).await {
            tracing::warn!(%err, "cover eviction failed");
        }
    }
    Ok(Json(cache_status(&data).await?))
}

#[derive(Deserialize)]
struct MissingQuery {
    limit: Option<usize>,
}

async fn missing(State(state): State<AppState>, Query(q): Query<MissingQuery>) -> Result<Json<Items<Value>>, ApiError> {
    let data = state.data()?;
    let items = data.db.call(move |c| cache_index::missing_keep_tracks(c, q.limit.unwrap_or(1))).await?;
    Ok(Json(Items { items }))
}

async fn fetch(State(state): State<AppState>, JsonBody(body): JsonBody<FetchRequest>) -> Result<(StatusCode, Json<FetchStatus>), ApiError> {
    check_id(&body.track_id)?;
    let data = state.data()?;
    let (started, status) = precache::start(&state, data, body).await?;
    Ok((if started { StatusCode::ACCEPTED } else { StatusCode::OK }, Json(status)))
}

async fn fetch_status(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<FetchStatus>, ApiError> {
    let data = state.data()?;
    if let Some(status) = state.fetches.status(&id) {
        return Ok(Json(status));
    }
    let lookup = id.clone();
    if data.db.call(move |c| cache_index::get(c, &lookup)).await?.is_some()
        && let Some(size) = data.cache.size(&id).await?
    {
        return Ok(Json(FetchStatus { state: "done", bytes: size, code: None }));
    }
    Err(ApiError::NotFound("no fetch for this track".into()))
}

async fn cancel_fetch(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    state.data()?;
    state.fetches.cancel(&id);
    Ok(StatusCode::NO_CONTENT)
}
