mod amll;

use std::time::Duration;

use nuvo_contracts::{LyricsCandidate, LyricsQuality, MatchedTrack, RawLyrics};
use serde::Deserialize;

pub use amll::{AMLL_URL, Amll};

pub const LRCLIB_URL: &str = "https://lrclib.net";
const DURATION_TOLERANCE_MS: i64 = 2000;

#[derive(Debug, thiserror::Error)]
pub enum LyricsError {
    #[error("lrclib request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("lrclib answered {0}")]
    Status(u16),
    #[error("the word lyrics index answered {0}")]
    Index(u16),
}

pub fn lrc_sync_level(content: &str) -> &'static str {
    let stamped = content.split('<').skip(1).any(|rest| {
        let mut parts = rest.split('>').next().unwrap_or_default().splitn(2, ':');
        let digits = |part: Option<&str>| part.is_some_and(|p| p.starts_with(|c: char| c.is_ascii_digit()) && p.chars().all(|c| c.is_ascii_digit() || c == '.'));
        digits(parts.next()) && digits(parts.next())
    });
    if stamped { "word_level" } else { "line_level" }
}

pub struct Query {
    pub title: String,
    pub artist: String,
    pub duration_ms: Option<i64>,
}

pub enum Lookup {
    Found(Box<LyricsCandidate>),
    Instrumental,
    NotFound,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct Record {
    track_name: String,
    artist_name: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

impl Record {
    fn duration_ms(&self) -> Option<i64> {
        self.duration.map(|s| (s * 1000.0).round() as i64)
    }

    fn synced(&self) -> Option<&str> {
        self.synced_lyrics.as_deref().filter(|s| !s.trim().is_empty())
    }

    fn plain(&self) -> Option<&str> {
        self.plain_lyrics.as_deref().filter(|s| !s.trim().is_empty())
    }
}

pub struct Lrclib {
    client: reqwest::Client,
    base: String,
}

impl Lrclib {
    pub fn new(base: impl Into<String>) -> Self {
        Self::with_proxy(base, None)
    }

    pub fn with_proxy(base: impl Into<String>, proxy: Option<reqwest::Proxy>) -> Self {
        let mut builder = reqwest::Client::builder().user_agent("nuvo-core/0.1 (personal music player)").timeout(Duration::from_secs(10));
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Self { client, base: base.into().trim_end_matches('/').to_string() }
    }

    pub async fn lookup(&self, query: &Query) -> Result<Lookup, LyricsError> {
        // An exact hit without lyrics (an empty record) falls through to the search.
        if let Some(duration_ms) = query.duration_ms.filter(|ms| *ms > 0)
            && let Some(record) = self.get(query, duration_ms).await?
            && let found @ (Lookup::Found(_) | Lookup::Instrumental) = to_lookup(&record, 1.0)
        {
            return Ok(found);
        }
        let records = self.search(query).await?;
        Ok(pick(records, query.duration_ms).map_or(Lookup::NotFound, |record| to_lookup(&record, 0.8)))
    }

    async fn get(&self, query: &Query, duration_ms: i64) -> Result<Option<Record>, LyricsError> {
        let seconds = ((duration_ms as f64) / 1000.0).round().to_string();
        let response = self
            .client
            .get(format!("{}/api/get", self.base))
            .query(&[("track_name", query.title.as_str()), ("artist_name", query.artist.as_str()), ("duration", seconds.as_str())])
            .send()
            .await?;
        match response.status().as_u16() {
            200 => Ok(Some(response.json().await?)),
            // The exact endpoint times out on LRCLIB's side now and then; the search may still answer.
            404 | 500..=599 => Ok(None),
            status => Err(LyricsError::Status(status)),
        }
    }

    async fn search(&self, query: &Query) -> Result<Vec<Record>, LyricsError> {
        let response = self
            .client
            .get(format!("{}/api/search", self.base))
            .query(&[("track_name", query.title.as_str()), ("artist_name", query.artist.as_str())])
            .send()
            .await?;
        match response.status().as_u16() {
            200 => Ok(response.json().await?),
            status => Err(LyricsError::Status(status)),
        }
    }
}

fn pick(records: Vec<Record>, duration_ms: Option<i64>) -> Option<Record> {
    let close_enough = |record: &Record| match (duration_ms, record.duration_ms()) {
        (Some(want), Some(have)) => (want - have).abs() <= DURATION_TOLERANCE_MS,
        _ => true,
    };
    let usable: Vec<Record> = records
        .into_iter()
        .filter(|r| close_enough(r) && (r.instrumental || r.synced().is_some() || r.plain().is_some()))
        .collect();
    usable.iter().find(|r| r.synced().is_some()).or_else(|| usable.first()).cloned()
}

fn to_lookup(record: &Record, match_score: f64) -> Lookup {
    let (format, content_kind, sync_level, content, total, sync) = if let Some(lrc) = record.synced() {
        ("lrc", "line_synced", lrc_sync_level(lrc), lrc, 0.8, 1.0)
    } else if let Some(text) = record.plain() {
        ("plain", "plain", "plain", text, 0.5, 0.0)
    } else if record.instrumental {
        return Lookup::Instrumental;
    } else {
        return Lookup::NotFound;
    };
    Lookup::Found(Box::new(LyricsCandidate {
        provider: "lrclib".into(),
        content_kind: content_kind.into(),
        sync_level: sync_level.into(),
        quality: LyricsQuality { total, match_score, content: 1.0, sync, source: 0.7, reasons: vec![] },
        lyrics: RawLyrics { format: format.into(), content: content.to_string() },
        matched_track: Some(MatchedTrack {
            title: record.track_name.clone(),
            artists: vec![record.artist_name.clone()],
            duration_ms: record.duration_ms(),
        }),
        top_priority: false,
    }))
}
