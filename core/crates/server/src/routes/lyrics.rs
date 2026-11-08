use std::collections::HashMap;
use std::convert::Infallible;
use std::future::Future;
use std::time::Instant;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{get, put};
use axum::{Json, Router};
use futures::Stream;
use nuvo_contracts::{
    ImportLyricsOffsets, ImportedLyricsOffsets, LyricsBest, LyricsCandidate, LyricsOffset, LyricsQuality, LyricsStreamEvent,
    LyricsTrackMeta, MAX_TRACK_ID_LEN, RawLyrics, SetLyricsOffset, SetUserLyrics,
};
use nuvo_lyrics::Lookup;
use nuvo_store::{lyrics_cache, lyrics_user, now_ms, tracks};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::{AppState, Unlocked};

/// Lyrics that were found are kept for good; a miss is retried after a week.
const MISS_TTL_MS: i64 = 7 * 86_400_000;

/// The legacy renderer map held a few hundred entries; this only bounds a hostile body.
const MAX_IMPORTED_OFFSETS: usize = 10_000;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/tracks/{id}/lyrics", get(lyrics))
        .route("/v1/tracks/{id}/lyrics/offset", put(set_offset))
        .route("/v1/tracks/{id}/lyrics/user", put(set_user_lyrics).delete(clear_user_lyrics))
        .route("/v1/lyrics/offsets", put(import_offsets))
}

fn valid_track_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_TRACK_ID_LEN
}

/// LRC needs at least one `[mm:ss` stamp, or it is plain text sent as LRC by mistake.
fn has_timed_line(content: &str) -> bool {
    content.lines().any(|line| {
        let line = line.trim_start().as_bytes();
        line.len() > 3 && line[0] == b'[' && line[1].is_ascii_digit() && line.contains(&b':')
    })
}

async fn set_user_lyrics(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<SetUserLyrics>,
) -> Result<StatusCode, ApiError> {
    if !valid_track_id(&id) {
        return Err(ApiError::Invalid(format!("track id must be 1 to {MAX_TRACK_ID_LEN} bytes")));
    }
    if body.format != "lrc" && body.format != "plain" {
        return Err(ApiError::Invalid("format must be lrc or plain".into()));
    }
    let content = body.content.trim().to_string();
    if content.is_empty() {
        return Err(ApiError::Invalid("lyrics are empty".into()));
    }
    if content.len() > lyrics_user::MAX_USER_LYRICS_BYTES {
        return Err(ApiError::Invalid(format!("lyrics are over {} bytes", lyrics_user::MAX_USER_LYRICS_BYTES)));
    }
    if body.format == "lrc" && !has_timed_line(&content) {
        return Err(ApiError::Invalid("LRC needs at least one timed line".into()));
    }
    let format = body.format;
    let data = state.data()?;
    data.db.call(move |c| lyrics_user::set_lyrics(c, &id, &format, &content, now_ms())).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear_user_lyrics(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    if !valid_track_id(&id) {
        return Err(ApiError::Invalid(format!("track id must be 1 to {MAX_TRACK_ID_LEN} bytes")));
    }
    let data = state.data()?;
    data.db.call(move |c| lyrics_user::clear_lyrics(c, &id, now_ms())).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The user's text as a found version; `topPriority` ranks it first in the renderer.
fn user_event(format: String, content: String) -> LyricsStreamEvent {
    let synced = format == "lrc";
    let (content_kind, sync_level) = if synced { ("line_synced", nuvo_lyrics::lrc_sync_level(&content)) } else { ("plain", "plain") };
    LyricsStreamEvent::Provider {
        provider: "user".into(),
        status: "found",
        sync_level: Some(sync_level.into()),
        candidate: Some(Box::new(LyricsCandidate {
            provider: "user".into(),
            content_kind: content_kind.into(),
            sync_level: sync_level.into(),
            quality: LyricsQuality { total: 1.0, match_score: 1.0, content: 1.0, sync: if synced { 1.0 } else { 0.0 }, source: 1.0, reasons: vec![] },
            lyrics: RawLyrics { format, content },
            matched_track: None,
            top_priority: true,
        })),
        message: None,
        duration_ms: 0,
    }
}

async fn set_offset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody<SetLyricsOffset>,
) -> Result<Json<LyricsOffset>, ApiError> {
    if !valid_track_id(&id) {
        return Err(ApiError::Invalid(format!("track id must be 1 to {MAX_TRACK_ID_LEN} bytes")));
    }
    let data = state.data()?;
    let offset_ms = data.db.call(move |c| lyrics_user::set_offset(c, &id, body.offset_ms, now_ms())).await?;
    Ok(Json(LyricsOffset { offset_ms }))
}

async fn import_offsets(
    State(state): State<AppState>,
    JsonBody(body): JsonBody<ImportLyricsOffsets>,
) -> Result<Json<ImportedLyricsOffsets>, ApiError> {
    if body.offsets.len() > MAX_IMPORTED_OFFSETS {
        return Err(ApiError::Invalid(format!("at most {MAX_IMPORTED_OFFSETS} offsets per import")));
    }
    let offsets: HashMap<String, i64> = body
        .offsets
        .into_iter()
        .filter(|(id, ms)| valid_track_id(id) && ms.is_finite())
        .map(|(id, ms)| (id, ms.round() as i64))
        .collect();
    let data = state.data()?;
    let imported = data.db.call(move |c| lyrics_user::import_offsets(c, &offsets, now_ms())).await?;
    Ok(Json(ImportedLyricsOffsets { imported }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hint {
    title: Option<String>,
    artist: Option<String>,
    duration_ms: Option<f64>,
}

async fn lyrics(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(hint): Query<Hint>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let data = state.data()?;
    let (tx, rx) = mpsc::channel(8);
    tokio::spawn(produce(state, data, id, hint, tx));
    let stream = futures::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|event| (Ok(event), rx)) });
    Ok(Sse::new(stream))
}

/// Emits the `LyricsStreamEvent` sequence the renderer expects: metadata, one provider event, done.
async fn produce(state: AppState, data: Unlocked, id: String, hint: Hint, tx: mpsc::Sender<Event>) {
    let send = |event: LyricsStreamEvent| {
        let tx = tx.clone();
        async move {
            let json = serde_json::to_string(&event).expect("lyrics events serialize");
            let _ = tx.send(Event::default().data(json)).await;
        }
    };
    let lookup_id = id.clone();
    let snapshot = data.db.call(move |c| tracks::snapshot(c, &lookup_id)).await.ok().flatten().unwrap_or(Value::Null);
    let non_empty = |s: Option<String>| s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let title = non_empty(hint.title).or_else(|| non_empty(snapshot["title"].as_str().map(String::from)));
    let artist = non_empty(hint.artist).or_else(|| non_empty(snapshot.pointer("/artists/0/name").and_then(Value::as_str).map(String::from)));
    let duration_ms = hint.duration_ms.map(|ms| ms.round() as i64).or_else(|| snapshot["durationMs"].as_f64().map(|ms| ms.round() as i64));
    let artists = match snapshot["artists"].as_array() {
        Some(list) if !list.is_empty() => list.clone(),
        _ => vec![json!({"id": "", "name": artist.clone().unwrap_or_default()})],
    };
    let offset_id = id.clone();
    let offset_ms = data.db.call(move |c| lyrics_user::offset(c, &offset_id)).await.unwrap_or(0);
    send(LyricsStreamEvent::Metadata {
        track: LyricsTrackMeta { id: id.clone(), title: title.clone().unwrap_or_default(), artists, duration_ms: duration_ms.unwrap_or(0) },
        offset_ms,
    })
    .await;

    let user_id = id.clone();
    if let Ok(Some((format, content))) = data.db.call(move |c| lyrics_user::user_lyrics(c, &user_id)).await {
        send(user_event(format, content)).await;
    }

    if id.starts_with("local:") {
        let lookup = id.clone();
        if let Ok(Some(local)) = data.db.call(move |c| nuvo_store::local::file_for(c, &lookup)).await
            && let Some(text) = read_sidecar(&local).await
        {
            // never cached: the owner may edit the file
            return found(&send, sidecar_candidate(text), 0, false).await;
        }
    }

    let query = title.zip(artist).map(|(title, artist)| nuvo_lyrics::Query { title, artist, duration_ms });
    // each sends its version as soon as it has one
    let lines = async {
        let outcome = line_version(&state, &data, &id, query.as_ref()).await;
        send(outcome.event()).await;
        outcome
    };
    let words = async {
        let started = Instant::now();
        let candidate = word_version(&state, &data, &id, query.as_ref()).await;
        if let Some(candidate) = &candidate {
            send(found_event(candidate.clone(), started.elapsed().as_millis() as i64)).await;
        }
        candidate
    };
    let (lines, words) = tokio::join!(lines, words);
    let cached = lines.cached;
    let instrumental = lines.instrumental;
    let failed = lines.message.is_some();
    match words.or(lines.candidate) {
        Some(best) => send(LyricsStreamEvent::Done { cached, best: Some(best_of(&best)), status: None }).await,
        None if instrumental => send(LyricsStreamEvent::Done { cached, best: None, status: Some("instrumental") }).await,
        None => send(LyricsStreamEvent::Done { cached: cached && !failed, best: None, status: Some("not_found") }).await,
    }
}

/// What the line source answered, from the cache or the network.
struct LineOutcome {
    candidate: Option<LyricsCandidate>,
    instrumental: bool,
    cached: bool,
    duration_ms: i64,
    message: Option<String>,
}

impl LineOutcome {
    fn miss(cached: bool, instrumental: bool, duration_ms: i64) -> Self {
        Self { candidate: None, instrumental, cached, duration_ms, message: None }
    }

    fn event(&self) -> LyricsStreamEvent {
        if let Some(candidate) = &self.candidate {
            return found_event(candidate.clone(), self.duration_ms);
        }
        let status = if self.message.is_some() { "error" } else { "not_found" };
        LyricsStreamEvent::Provider { provider: "lrclib".into(), status, sync_level: None, candidate: None, message: self.message.clone(), duration_ms: self.duration_ms }
    }
}

async fn line_version(state: &AppState, data: &Unlocked, id: &str, query: Option<&nuvo_lyrics::Query>) -> LineOutcome {
    let cache_id = id.to_string();
    if let Ok(Some(cached)) = data.db.call(move |c| lyrics_cache::get(c, &cache_id)).await {
        match cached.candidate {
            Some(candidate) => return LineOutcome { candidate: Some(candidate), instrumental: false, cached: true, duration_ms: 0, message: None },
            None if now_ms() - cached.fetched_at < MISS_TTL_MS => return LineOutcome::miss(true, cached.instrumental, 0),
            None => {}
        }
    }
    let Some(query) = query else {
        return LineOutcome::miss(false, false, 0);
    };
    let started = Instant::now();
    let result = state.lrclib.lookup(query).await;
    let elapsed = started.elapsed().as_millis() as i64;
    let (candidate, instrumental) = match result {
        Ok(Lookup::Found(candidate)) => (Some(*candidate), false),
        Ok(Lookup::Instrumental) => (None, true),
        Ok(Lookup::NotFound) => (None, false),
        Err(err) => return LineOutcome { candidate: None, instrumental: false, cached: false, duration_ms: elapsed, message: Some(err.to_string()) },
    };
    let stored = candidate.clone();
    let cache_id = id.to_string();
    let _ = data.db.call(move |c| lyrics_cache::put(c, &cache_id, stored.as_ref(), instrumental, now_ms())).await;
    LineOutcome { candidate, instrumental, cached: false, duration_ms: elapsed, message: None }
}

/// The word source keeps its own row, so a song cached before it existed still gets looked up once.
async fn word_version(state: &AppState, data: &Unlocked, id: &str, query: Option<&nuvo_lyrics::Query>) -> Option<LyricsCandidate> {
    let amll = state.amll.as_ref()?;
    let key = format!("{id}#words");
    let cache_key = key.clone();
    if let Ok(Some(cached)) = data.db.call(move |c| lyrics_cache::get(c, &cache_key)).await {
        match cached.candidate {
            Some(candidate) => return Some(candidate),
            None if now_ms() - cached.fetched_at < MISS_TTL_MS => return None,
            None => {}
        }
    }
    // a failure is not a miss: the next play asks again
    let candidate = amll.lookup(query?).await.ok()?;
    let stored = candidate.clone();
    let _ = data.db.call(move |c| lyrics_cache::put(c, &key, stored.as_ref(), false, now_ms())).await;
    candidate
}

fn best_of(candidate: &LyricsCandidate) -> LyricsBest {
    LyricsBest { provider: candidate.provider.clone(), quality: candidate.quality.total, sync_level: candidate.sync_level.clone() }
}

fn found_event(candidate: LyricsCandidate, duration_ms: i64) -> LyricsStreamEvent {
    LyricsStreamEvent::Provider {
        provider: candidate.provider.clone(),
        status: "found",
        sync_level: Some(candidate.sync_level.clone()),
        candidate: Some(Box::new(candidate)),
        message: None,
        duration_ms,
    }
}

async fn found<F, Fut>(send: &F, candidate: LyricsCandidate, duration_ms: i64, cached: bool)
where
    F: Fn(LyricsStreamEvent) -> Fut,
    Fut: Future<Output = ()>,
{
    let best = best_of(&candidate);
    send(found_event(candidate, duration_ms)).await;
    send(LyricsStreamEvent::Done { cached, best: Some(best), status: None }).await;
}

const MAX_LRC_BYTES: u64 = 512 * 1024;

/// The `.lrc` next to a local file, when it is still a small regular file in the same folder,
/// inside the music folder and reached through no link.
async fn read_sidecar(local: &nuvo_store::local::LocalFile) -> Option<String> {
    let lrc = std::path::PathBuf::from(local.row.lrc_path.as_ref()?);
    if lrc.parent() != std::path::Path::new(&local.row.path).parent() {
        return None;
    }
    let root = std::path::PathBuf::from(&local.root_path);
    let bytes = tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let file = nuvo_local::open::open_inside(&lrc, &root).ok()?;
        let mut bytes = Vec::new();
        file.take(MAX_LRC_BYTES + 1).read_to_end(&mut bytes).ok()?;
        (bytes.len() as u64 <= MAX_LRC_BYTES).then_some(bytes)
    })
    .await
    .ok()??;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// A sidecar beats online sources: the owner put it there for this very file.
pub fn sidecar_candidate(text: String) -> LyricsCandidate {
    let synced = text.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with('[') && line[1..].starts_with(|c: char| c.is_ascii_digit())
    });
    let (format, kind, level, sync) = if synced { ("lrc", "line_synced", nuvo_lyrics::lrc_sync_level(&text), 1.0) } else { ("plain", "plain", "plain", 0.0) };
    LyricsCandidate {
        provider: "local_file".into(),
        content_kind: kind.into(),
        sync_level: level.into(),
        quality: nuvo_contracts::LyricsQuality { total: 0.95, match_score: 1.0, content: 1.0, sync, source: 1.0, reasons: vec!["sidecar".into()] },
        lyrics: nuvo_contracts::RawLyrics { format: format.into(), content: text },
        matched_track: None,
        top_priority: false,
    }
}
