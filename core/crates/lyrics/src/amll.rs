// AMLL TTML database (CC0); a file counts only when its timing fits the playing stream

use std::sync::Arc;
use std::time::{Duration, Instant};

use nuvo_contracts::{LyricsCandidate, LyricsQuality, MatchedTrack, RawLyrics};
use reqwest::Url;
use reqwest::redirect::Policy;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::{DURATION_TOLERANCE_MS, LyricsError, MusicBrainz, Query, USER_AGENT};

pub const AMLL_URL: &str = "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main";
const ALLOWED_HOST: &str = "raw.githubusercontent.com";
const INDEX_PATH: &str = "metadata/raw-lyrics-index.jsonl";
const INDEX_TTL: Duration = Duration::from_secs(24 * 3600);
const MAX_INDEX_BYTES: usize = 16 * 1024 * 1024;
/// The renderer ignores larger texts.
const MAX_FILE_BYTES: usize = 256 * 1024;
/// The index lists a song more than once when it was redone, newest last.
const MAX_FILES_PER_LOOKUP: usize = 3;
const END_SLACK_MS: i64 = 3000;

#[derive(Deserialize)]
struct Row {
    metadata: Vec<(String, Vec<String>)>,
    #[serde(rename = "rawLyricFile")]
    raw_lyric_file: String,
}

#[derive(Clone)]
struct Entry {
    titles: Vec<String>,
    artists: Vec<String>,
    isrcs: Vec<String>,
    file: String,
}

struct Index {
    fetched: Instant,
    entries: Arc<Vec<Entry>>,
}

pub struct Amll {
    client: reqwest::Client,
    base: String,
    index: Mutex<Option<Index>>,
    lengths: Option<Arc<MusicBrainz>>,
}

// Deny by default: https on the one allowed host; plain http only for a local stand-in
fn allowed(base: &str) -> bool {
    let Ok(url) = Url::parse(base) else { return false };
    if url.host_str() == Some("127.0.0.1") {
        return true;
    }
    url.scheme() == "https" && url.host_str() == Some(ALLOWED_HOST) && url.port().is_none() && url.username().is_empty() && url.password().is_none()
}

/// A file name straight from the index: no way out of the lyrics folder.
fn safe_file(name: &str) -> bool {
    name.ends_with(".ttml") && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

impl Amll {
    pub fn new(base: &str, lengths: Option<Arc<MusicBrainz>>) -> Option<Self> {
        Self::with_proxy(base, lengths, None)
    }

    pub fn with_proxy(base: &str, lengths: Option<Arc<MusicBrainz>>, proxy: Option<reqwest::Proxy>) -> Option<Self> {
        if !allowed(base) {
            return None;
        }
        let mut builder = reqwest::Client::builder().user_agent(USER_AGENT).timeout(Duration::from_secs(10)).redirect(Policy::none());
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Some(Self { client, base: base.trim_end_matches('/').to_string(), index: Mutex::new(None), lengths })
    }

    /// Index entries for the query, newest first, at most a few.
    async fn matching(&self, query: &Query) -> Result<Vec<Entry>, LyricsError> {
        let (title, artist) = (plain_title(&query.title), plain(&query.artist));
        if title.is_empty() || artist.is_empty() {
            return Ok(Vec::new());
        }
        let entries = self.entries().await?;
        let found = entries.iter().rev().filter(|entry| entry.titles.contains(&title) && entry.artists.iter().any(|name| artist.contains(name.as_str())));
        Ok(found.filter(|entry| safe_file(&entry.file)).take(MAX_FILES_PER_LOOKUP).cloned().collect())
    }

    pub async fn lookup(&self, query: &Query) -> Result<Option<LyricsCandidate>, LyricsError> {
        for entry in self.matching(query).await? {
            let release_ms = self.release_length(&entry).await;
            if !same_cut(release_ms.as_deref(), query.duration_ms) {
                continue;
            }
            let Some(content) = self.file(&entry.file).await else { continue };
            if fits(&content, query.duration_ms) {
                let length = closest(release_ms.as_deref(), query.duration_ms);
                return Ok(Some(candidate(query, content, length)));
            }
        }
        Ok(None)
    }

    /// Word-timed files for a search the owner typed, newest first, whatever their length.
    pub async fn search_all(&self, query: &Query) -> Result<Vec<LyricsCandidate>, LyricsError> {
        let mut found = Vec::new();
        for entry in self.matching(query).await? {
            let Some(content) = self.file(&entry.file).await.filter(|content| last_word_end(content).is_some()) else { continue };
            let length = closest(self.release_length(&entry).await.as_deref(), query.duration_ms);
            found.push(candidate(&Query { duration_ms: None, ..query.clone() }, content, length));
        }
        Ok(found)
    }

    async fn release_length(&self, entry: &Entry) -> Option<Vec<i64>> {
        let lengths = self.lengths.as_ref()?;
        for isrc in &entry.isrcs {
            if let Some(found) = lengths.isrc_lengths(isrc).await.filter(|found| !found.is_empty()) {
                return Some(found);
            }
        }
        None
    }

    async fn entries(&self) -> Result<Arc<Vec<Entry>>, LyricsError> {
        let mut index = self.index.lock().await;
        if let Some(current) = index.as_ref().filter(|index| index.fetched.elapsed() < INDEX_TTL) {
            return Ok(current.entries.clone());
        }
        let url = format!("{}/{INDEX_PATH}", self.base);
        let response = self.client.get(url).send().await?;
        let status = response.status().as_u16();
        if status != 200 {
            return Err(LyricsError::Index(status));
        }
        let bytes = read_capped(response, MAX_INDEX_BYTES).await?.ok_or(LyricsError::Index(status))?;
        let entries = Arc::new(parse_index(&String::from_utf8_lossy(&bytes)));
        *index = Some(Index { fetched: Instant::now(), entries: entries.clone() });
        Ok(entries)
    }

    async fn file(&self, name: &str) -> Option<String> {
        let response = self.client.get(format!("{}/raw-lyrics/{name}", self.base)).send().await.ok()?;
        if response.status().as_u16() != 200 {
            return None;
        }
        String::from_utf8(read_capped(response, MAX_FILE_BYTES).await.ok()??).ok()
    }
}

async fn read_capped(mut response: reqwest::Response, limit: usize) -> Result<Option<Vec<u8>>, reqwest::Error> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Some(bytes))
}

fn parse_index(text: &str) -> Vec<Entry> {
    text.lines()
        .filter_map(|line| serde_json::from_str::<Row>(line).ok())
        .map(|row| Entry {
            titles: field(&row, "musicName", plain_title),
            artists: field(&row, "artists", plain),
            isrcs: field(&row, "isrc", |isrc| isrc.trim().to_ascii_uppercase()),
            file: row.raw_lyric_file.clone(),
        })
        .collect()
}

fn field(row: &Row, key: &str, clean: fn(&str) -> String) -> Vec<String> {
    let values = row.metadata.iter().filter(|(name, _)| name == key).flat_map(|(_, values)| values);
    values.map(|value| clean(value)).filter(|value| !value.is_empty()).collect()
}

fn plain(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn plain_title(title: &str) -> String {
    let mut depth = 0usize;
    let bare: String = title
        .chars()
        .filter(|c| match c {
            '(' | '[' | '（' | '【' => {
                depth += 1;
                false
            }
            ')' | ']' | '）' | '】' => {
                depth = depth.saturating_sub(1);
                false
            }
            _ => depth == 0,
        })
        .collect();
    let bare = plain(&bare);
    if bare.is_empty() { plain(title) } else { bare }
}

fn time_ms(text: &str) -> Option<i64> {
    let seconds = text.trim_end_matches('s').split(':').try_fold(0.0, |total: f64, part| part.parse::<f64>().ok().map(|value| total * 60.0 + value))?;
    seconds.is_finite().then(|| (seconds * 1000.0).round() as i64)
}

fn last_word_end(ttml: &str) -> Option<i64> {
    ttml.split("<span").skip(1).filter_map(|span| {
        let tag = span.split('>').next()?;
        let value = tag.split(" end=\"").nth(1)?.split('"').next()?;
        time_ms(value)
    })
    .max()
}

/// With the release length known, the stream must be that cut; a music video with an intro is not.
fn same_cut(release_ms: Option<&[i64]>, duration_ms: Option<i64>) -> bool {
    match (release_ms, duration_ms.filter(|ms| *ms > 0)) {
        (Some(lengths), Some(duration)) => lengths.iter().any(|length| (length - duration).abs() <= DURATION_TOLERANCE_MS),
        _ => true,
    }
}

fn closest(release_ms: Option<&[i64]>, duration_ms: Option<i64>) -> Option<i64> {
    let lengths = release_ms?;
    let duration = duration_ms.unwrap_or_default();
    lengths.iter().copied().min_by_key(|length| (length - duration).abs())
}

/// Without a release length: the words must end inside the track and cover at least half of it.
fn fits(ttml: &str, duration_ms: Option<i64>) -> bool {
    let Some(end) = last_word_end(ttml) else { return false };
    duration_ms.filter(|ms| *ms > 0).is_none_or(|duration| end <= duration + END_SLACK_MS && end * 2 >= duration)
}

fn candidate(query: &Query, content: String, release_ms: Option<i64>) -> LyricsCandidate {
    let match_score = if query.duration_ms.is_some() { 1.0 } else { 0.8 };
    LyricsCandidate {
        provider: "amll".into(),
        content_kind: "word_synced".into(),
        sync_level: "word_level".into(),
        quality: LyricsQuality { total: 0.9, match_score, content: 1.0, sync: 1.0, source: 0.8, reasons: vec![] },
        lyrics: RawLyrics { format: "ttml".into(), content },
        matched_track: Some(MatchedTrack { title: query.title.clone(), artists: vec![query.artist.clone()], duration_ms: release_ms.or(query.duration_ms) }),
        top_priority: false,
        made: None,
    }
}
