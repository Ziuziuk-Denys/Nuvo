use std::io;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use nuvo_cache::CacheWriter;
use nuvo_contracts::Items;
use nuvo_contracts::catalog::{ArtistDetails, Page, SearchResult, SetSummary, StreamDescriptor, Track, TrackDetails};
use nuvo_contracts::iso_from_ms;
use nuvo_fetch::ytdlp;
use nuvo_soundcloud::play::format_of;
use nuvo_soundcloud::{AudioSink, Format, Playable, Reason, ScError, TypeFilter, ids};
use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_store::now_ms;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::routes::cache::{evict, serve};
use crate::state::{AppState, Unlocked};

const RELATED_DEFAULT: usize = 25;
const RELATED_MAX: usize = 50;
const YT_DLP_TIMEOUT: Duration = Duration::from_secs(30);

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/sc/tracks/{id}", get(track))
        .route("/v1/sc/tracks/{id}/related", get(related))
        .route("/v1/sc/tracks/{id}/stream", get(stream))
        .route("/v1/sc/tracks/{id}/audio", get(audio))
        .route("/v1/sc/sets/{id}", get(set))
        .route("/v1/sc/users/{id}", get(user))
        .route("/v1/sc/users/{id}/tracks", get(user_tracks))
        .route("/v1/sc/users/{id}/releases", get(user_releases))
        .route("/v1/sc/users/{id}/avatar", get(avatar))
        .route("/v1/sc/lookup", get(lookup))
        .route("/v1/sc/import", get(import))
        .route("/v1/sc/search", get(search))
}

async fn track(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<TrackDetails>, ApiError> {
    Ok(Json(state.soundcloud().await.track(&id).await?))
}

#[derive(Deserialize)]
struct RelatedQuery {
    limit: Option<usize>,
}

async fn related(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<RelatedQuery>) -> Result<Json<Items<Track>>, ApiError> {
    let limit = q.limit.unwrap_or(RELATED_DEFAULT).clamp(1, RELATED_MAX);
    Ok(Json(Items { items: state.soundcloud().await.related(&id, limit).await? }))
}

#[derive(Deserialize)]
struct SetQuery {
    view: Option<String>,
}

async fn set(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<SetQuery>) -> Result<Response, ApiError> {
    let sc = state.soundcloud().await;
    match q.view.as_deref().unwrap_or("playlist") {
        "album" => Ok(Json(sc.album(&id).await?).into_response()),
        "playlist" => Ok(Json(sc.playlist(&id).await?).into_response()),
        other => Err(ApiError::Invalid(format!("view must be album or playlist, not {other}"))),
    }
}

async fn user(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<ArtistDetails>, ApiError> {
    Ok(Json(state.soundcloud().await.artist(&id).await?))
}

#[derive(Deserialize)]
struct PageQuery {
    cursor: Option<String>,
}

fn cursor(q: PageQuery) -> Result<String, ApiError> {
    q.cursor.filter(|c| !c.is_empty()).ok_or_else(|| ApiError::Invalid("cursor is required".into()))
}

async fn user_tracks(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<PageQuery>) -> Result<Json<Page<Track>>, ApiError> {
    Ok(Json(state.soundcloud().await.artist_tracks(&id, &cursor(q)?).await?))
}

async fn user_releases(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<PageQuery>) -> Result<Json<Page<SetSummary>>, ApiError> {
    Ok(Json(state.soundcloud().await.artist_releases(&id, &cursor(q)?).await?))
}

async fn avatar(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"url": state.soundcloud().await.avatar(&id).await?})))
}

#[derive(Deserialize)]
struct LookupQuery {
    url: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

async fn lookup(State(state): State<AppState>, Query(q): Query<LookupQuery>) -> Result<Json<Items<SearchResult>>, ApiError> {
    let kind = q.kind.as_deref().unwrap_or("all");
    let filter = TypeFilter::parse(kind).ok_or_else(|| ApiError::Invalid(format!("type must be all, track, album, playlist or artist, not {kind}")))?;
    let items = state.soundcloud().await.lookup(q.url.as_deref().unwrap_or_default(), filter).await;
    Ok(Json(Items { items }))
}

#[derive(Deserialize)]
struct ImportQuery {
    url: Option<String>,
}

async fn import(State(state): State<AppState>, Query(q): Query<ImportQuery>) -> Result<Json<Value>, ApiError> {
    let url = q.url.as_deref().map(str::trim).filter(|u| !u.is_empty() && u.len() <= 2048).ok_or_else(|| ApiError::Invalid("url is required".into()))?;
    let listing = state.soundcloud().await.import_listing(url).await?;
    let mut answer = json!({"label": listing.label, "rows": listing.rows});
    if listing.partial {
        answer["partial"] = json!(true);
    }
    if let Some(name) = listing.likes_of {
        answer["likesOf"] = json!(name);
    }
    Ok(Json(answer))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    limit: Option<usize>,
}

const SEARCH_DEFAULT: usize = 25;
const SEARCH_MAX: usize = 50;

async fn search(State(state): State<AppState>, Query(q): Query<SearchQuery>) -> Result<Json<Items<Track>>, ApiError> {
    let query = q.q.as_deref().map(str::trim).filter(|q| !q.is_empty() && q.chars().count() <= 200).ok_or_else(|| ApiError::Invalid("q is required, at most 200 characters".into()))?;
    let limit = q.limit.unwrap_or(SEARCH_DEFAULT).clamp(1, SEARCH_MAX);
    let records = state.soundcloud().await.search_tracks(query, limit).await?;
    let mut items: Vec<Track> = records.iter().filter_map(nuvo_soundcloud::map::track).take(limit).collect();
    items.sort_by_key(|track| track.preview.is_some());
    Ok(Json(Items { items }))
}

struct CacheSink {
    data: Option<Unlocked>,
    key: String,
    writer: Option<CacheWriter>,
    refused: bool,
}

impl AudioSink for CacheSink {
    async fn write(&mut self, chunk: &[u8]) -> io::Result<()> {
        let Some(data) = &self.data else {
            self.refused = true;
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "library is locked"));
        };
        if self.writer.is_none() {
            self.writer = Some(data.cache.begin(&self.key).await.map_err(io::Error::other)?);
        }
        self.writer.as_mut().expect("writer was just created").write(chunk).await.map_err(io::Error::other)
    }

    async fn discard(&mut self) {
        if let Some(writer) = self.writer.take() {
            writer.abort().await;
        }
    }
}

impl Drop for CacheSink {
    fn drop(&mut self) {
        if let Some(writer) = &self.writer {
            let _ = std::fs::remove_file(writer.part_path());
        }
    }
}

impl CacheSink {
    async fn finish(mut self, format: Format) -> Result<u64, ApiError> {
        let (Some(data), Some(writer)) = (self.data.clone(), self.writer.take()) else {
            return Err(ApiError::Upstream("SoundCloud sent no audio".into()));
        };
        let finished = writer.finish().await?;
        let entry = CacheEntry {
            track_id: self.key.clone(),
            path: finished.path.to_string_lossy().into_owned(),
            size_bytes: finished.size as i64,
            mime: format.mime.to_string(),
            codec: Some(format.codec.to_string()),
        };
        data.db.call(move |c| cache_index::upsert(c, &entry, now_ms())).await?;
        if let Err(err) = evict(&data, Some(&self.key)).await {
            tracing::warn!("cache eviction failed: {:?}", err);
        }
        Ok(finished.size)
    }
}

fn local(key: &str, format: Format, size: u64) -> StreamDescriptor {
    StreamDescriptor {
        kind: "local",
        url: format!("nuvo-core://local/v1/sc/tracks/{key}/audio"),
        expires_at: None,
        codec: format.codec,
        mime_type: format.mime,
        bitrate: format.bitrate,
        content_length: Some(size),
    }
}

async fn cached(data: &Unlocked, key: &str) -> Option<(CacheEntry, u64)> {
    let lookup = key.to_string();
    let entry = data.db.call(move |c| cache_index::get(c, &lookup)).await.ok().flatten()?;
    let size = data.cache.size(key).await.ok().flatten().filter(|s| *s > 0)?;
    Some((entry, size))
}

async fn stream(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<StreamDescriptor>, ApiError> {
    let num = ids::track_num(&id).ok_or_else(|| ApiError::Invalid(format!("{id} is not a SoundCloud id")))?;
    let key = ids::track_id(num);
    // Locked is fine here (the catalog still resolves); starting is not, so the engine retries.
    if state.is_starting() {
        return Err(ApiError::Starting);
    }
    let data = state.data().ok();
    if let Some(data) = &data
        && let Some((entry, size)) = cached(data, &key).await
    {
        // Bitrate is not stored with cached audio; the codec's default stands in.
        return Ok(Json(local(&key, format_of(entry.codec.as_deref().unwrap_or_default(), &entry.mime), size)));
    }
    let mut sink = CacheSink { data, key: key.clone(), writer: None, refused: false };
    let sc = state.soundcloud().await;
    let resolved = match sc.resolve(&key, &mut sink).await {
        Err(err) if !sink.refused && worth_yt_dlp(&err) => match yt_dlp_info(&state, num).await {
            Some(info) => sc.resolve_external(&key, &info, &mut sink).await.map_err(|fallback| {
                tracing::info!(%fallback, "SoundCloud: yt-dlp could not play the track either");
                err
            }),
            None => Err(err),
        },
        other => other,
    };
    match resolved {
        Ok(Playable::Direct { url, expires_ms, format }) => Ok(Json(StreamDescriptor {
            kind: "direct",
            url,
            expires_at: Some(iso_from_ms(expires_ms)),
            codec: format.codec,
            mime_type: format.mime,
            bitrate: format.bitrate,
            content_length: None,
        })),
        Ok(Playable::Assembled { format, .. }) => {
            let size = sink.finish(format).await?;
            Ok(Json(local(&key, format, size)))
        }
        Err(_) if sink.refused => Err(ApiError::Locked),
        Err(err) => Err(err.into()),
    }
}

fn worth_yt_dlp(err: &ScError) -> bool {
    !matches!(
        err,
        ScError::Unplayable(Reason::Gone | Reason::RegionBlocked | Reason::Preview | Reason::StreamDisabled | Reason::Drm) | ScError::NotFound | ScError::Invalid(_) | ScError::RateLimited
    )
}

async fn yt_dlp_info(state: &AppState, num: u64) -> Option<Value> {
    let Some(yt_dlp) = state.env.find("yt-dlp") else {
        crate::tool_update::request(state, None);
        return None;
    };
    let (runtime, proxy) = (state.env.js_runtime(), state.proxy_url());
    let url = format!("https://api.soundcloud.com/tracks/{num}");
    let info = ytdlp::info(&yt_dlp, runtime.as_deref(), &url, proxy.as_deref());
    let json = tokio::time::timeout(YT_DLP_TIMEOUT, info).await.ok()?.ok()?;
    serde_json::from_slice(&json).ok()
}

async fn audio(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> Result<Response, ApiError> {
    let num = ids::track_num(&id).ok_or_else(|| ApiError::Invalid(format!("{id} is not a SoundCloud id")))?;
    serve(&state.data()?, ids::track_id(num), &headers).await
}
