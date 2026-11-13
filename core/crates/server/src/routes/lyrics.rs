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
use nuvo_store::{lyrics_cache, lyrics_user, lyrics_words, now_ms, tracks};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::{AppState, Unlocked};

const MISS_TTL_MS: i64 = 7 * 86_400_000;

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
        let aligned = if format == "lrc" { aligned_for(&data, &id, &content, true).await } else { None };
        send(user_event(format, content)).await;
        if let Some(aligned) = aligned {
            send(found_event(aligned, 0)).await;
        }
    }

    if id.starts_with("local:") {
        let lookup = id.clone();
        if let Ok(Some(local)) = data.db.call(move |c| nuvo_store::local::file_for(c, &lookup)).await
            && let Some(text) = read_sidecar(&local).await
        {
            // never cached: the owner may edit the file
            let candidate = sidecar_candidate(text);
            return match aligned_for(&data, &id, &candidate.lyrics.content, false).await {
                Some(aligned) => {
                    send(found_event(candidate, 0)).await;
                    found(&send, aligned, 0, false).await
                }
                None => found(&send, candidate, 0, false).await,
            };
        }
    }

    let queries = match title.zip(artist) {
        Some((title, artist)) if id.starts_with("sc:") => soundcloud_queries(&title, &artist, duration_ms),
        Some((title, artist)) => vec![nuvo_lyrics::Query { title, artist, duration_ms }],
        None => Vec::new(),
    };
    let query = queries.first();
    let lines = async {
        let outcome = line_version(&state, &data, &id, &queries).await;
        send(outcome.event()).await;
        outcome
    };
    let words = async {
        let started = Instant::now();
        let candidate = word_version(&state, &data, &id, query).await;
        if let Some(candidate) = &candidate {
            send(found_event(candidate.clone(), started.elapsed().as_millis() as i64)).await;
        }
        candidate
    };
    let (lines, words) = tokio::join!(lines, words);
    let cached = lines.cached;
    let instrumental = lines.instrumental;
    let failed = lines.message.is_some();
    let aligned = match (&words, &lines.candidate) {
        (None, Some(line)) => aligned_for(&data, &id, &line.lyrics.content, false).await,
        _ => None,
    };
    if let Some(aligned) = &aligned {
        send(found_event(aligned.clone(), 0)).await;
    }
    match words.or(aligned).or(lines.candidate) {
        Some(best) => send(LyricsStreamEvent::Done { cached, best: Some(best_of(&best)), status: None }).await,
        None if instrumental => send(LyricsStreamEvent::Done { cached, best: None, status: Some("instrumental") }).await,
        None => send(LyricsStreamEvent::Done { cached: cached && !failed, best: None, status: Some("not_found") }).await,
    }
}

const UPLOAD_TAGS: [&str; 12] = ["slowed", "reverb", "sped up", "speed up", "nightcore", "free", "prod", "bass boost", "bassboost", "8d", "original version", "original mix"];

fn without_upload_tags(raw: &str) -> String {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(open) = rest.find(['(', '[', '{']) {
        let close = match rest.as_bytes()[open] {
            b'(' => ')',
            b'[' => ']',
            _ => '}',
        };
        let Some(end) = rest[open..].find(close).map(|i| open + i) else { break };
        let inside = rest[open + 1..end].to_lowercase();
        out.push_str(&rest[..open]);
        if !UPLOAD_TAGS.iter().any(|tag| inside.contains(tag)) {
            out.push_str(&rest[open..=end]);
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    let kept: Vec<&str> = out.split_whitespace().filter(|word| !word.starts_with('#')).collect();
    let mut words = kept;
    while words.last().is_some_and(|word| UPLOAD_TAGS.contains(&word.to_lowercase().as_str())) {
        words.pop();
    }
    words.join(" ")
}

fn without_featuring(artist: &str) -> String {
    let lower = artist.to_lowercase();
    let cut = [" feat.", " feat ", " ft.", " ft ", " featuring "].iter().filter_map(|mark| lower.find(mark)).min();
    // lowercasing can shift byte offsets in rare scripts
    match cut.filter(|i| artist.is_char_boundary(*i)) {
        Some(i) => artist[..i].trim().to_string(),
        None => artist.trim().to_string(),
    }
}

/// SoundCloud uploads put the performer in the title and tag it; each guess is asked in turn.
fn soundcloud_queries(title: &str, uploader: &str, duration_ms: Option<i64>) -> Vec<nuvo_lyrics::Query> {
    let cleaned = nuvo_match::text::clean_title(&without_upload_tags(title));
    let mut guesses = match nuvo_match::text::artist_and_title(&cleaned) {
        (Some(artist), song) => vec![(without_featuring(&artist), song.clone()), (song, artist), (uploader.to_string(), cleaned.clone())],
        (None, song) => vec![(uploader.to_string(), song)],
    };
    let mut seen = Vec::new();
    guesses.retain(|(artist, song)| {
        let key = (artist.to_lowercase(), song.to_lowercase());
        let fresh = !artist.trim().is_empty() && !song.trim().is_empty() && !seen.contains(&key);
        seen.push(key);
        fresh
    });
    guesses.into_iter().map(|(artist, title)| nuvo_lyrics::Query { title, artist, duration_ms }).collect()
}

/// Word timing worked out on this computer for exactly these lyrics.
async fn aligned_for(data: &Unlocked, id: &str, lyrics: &str, top_priority: bool) -> Option<LyricsCandidate> {
    let lookup = id.to_string();
    let timing = data.db.call(move |c| lyrics_words::get(c, &lookup)).await.ok()??;
    (timing.source_hash == crate::word_timing::source_hash(lyrics)).then(|| LyricsCandidate {
        provider: "aligned".into(),
        content_kind: "word_synced".into(),
        sync_level: "word_level".into(),
        quality: LyricsQuality { total: 0.85, match_score: 1.0, content: 1.0, sync: 1.0, source: 0.8, reasons: vec![timing.model] },
        lyrics: RawLyrics { format: "ttml".into(), content: timing.content },
        matched_track: None,
        top_priority,
    })
}

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

async fn line_version(state: &AppState, data: &Unlocked, id: &str, queries: &[nuvo_lyrics::Query]) -> LineOutcome {
    let cache_id = id.to_string();
    if let Ok(Some(cached)) = data.db.call(move |c| lyrics_cache::get(c, &cache_id)).await {
        match cached.candidate {
            Some(candidate) => return LineOutcome { candidate: Some(candidate), instrumental: false, cached: true, duration_ms: 0, message: None },
            None if now_ms() - cached.fetched_at < MISS_TTL_MS => return LineOutcome::miss(true, cached.instrumental, 0),
            None => {}
        }
    }
    if queries.is_empty() {
        return LineOutcome::miss(false, false, 0);
    }
    let started = Instant::now();
    let (mut candidate, mut instrumental) = (None, false);
    for query in queries {
        match state.lrclib.lookup(query).await {
            Ok(Lookup::Found(found)) => candidate = Some(*found),
            Ok(Lookup::Instrumental) => instrumental = true,
            Ok(Lookup::NotFound) => continue,
            Err(err) => {
                let elapsed = started.elapsed().as_millis() as i64;
                return LineOutcome { candidate: None, instrumental: false, cached: false, duration_ms: elapsed, message: Some(err.to_string()) };
            }
        }
        break;
    }
    let elapsed = started.elapsed().as_millis() as i64;
    let stored = candidate.clone();
    let cache_id = id.to_string();
    let _ = data.db.call(move |c| lyrics_cache::put(c, &cache_id, stored.as_ref(), instrumental, now_ms())).await;
    LineOutcome { candidate, instrumental, cached: false, duration_ms: elapsed, message: None }
}

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

pub(crate) async fn read_sidecar(local: &nuvo_store::local::LocalFile) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::soundcloud_queries;

    fn guesses(title: &str, uploader: &str) -> Vec<(String, String)> {
        soundcloud_queries(title, uploader, None).into_iter().map(|q| (q.artist, q.title)).collect()
    }

    #[test]
    fn soundcloud_titles_lose_upload_tags_and_name_the_performer() {
        assert_eq!(guesses("Linkin Park - Numb (slowed + reverb) [FREE]", "arushi")[0], ("Linkin Park".into(), "Numb".into()));
        assert_eq!(guesses("Numb (prod. by Someone) #nightcore", "LINKIN PARK"), [("LINKIN PARK".into(), "Numb".into())]);
        assert_eq!(guesses("MiyaGi & Endshpil Feat. Rem Digga - I Got Love", "Emir B.")[0], ("MiyaGi & Endshpil".into(), "I Got Love".into()));
        assert_eq!(guesses("Кино - Группа крови slowed", "uu")[0], ("Кино".into(), "Группа крови".into()));
    }

    #[test]
    fn a_title_that_names_the_artist_last_is_tried_both_ways() {
        let tried = guesses("Get Lucky [Original Version] - Daft Punk", "DJ KB");
        assert_eq!(tried[0], ("Get Lucky".into(), "Daft Punk".into()));
        assert_eq!(tried[1], ("Daft Punk".into(), "Get Lucky".into()));
        assert_eq!(tried[2], ("DJ KB".into(), "Get Lucky - Daft Punk".into()));
    }
}
