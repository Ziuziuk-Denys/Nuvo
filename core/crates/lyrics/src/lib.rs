mod amll;
mod lyricsfile;
mod musicbrainz;

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use nuvo_contracts::{LyricsCandidate, LyricsQuality, MatchedTrack, RawLyrics};
use serde::Deserialize;

pub use amll::{AMLL_URL, Amll};
pub use musicbrainz::{MUSICBRAINZ_URL, MusicBrainz};

pub const LRCLIB_URL: &str = "https://lrclib.net";
pub const USER_AGENT: &str = concat!("Nuvo/", env!("CARGO_PKG_VERSION"), " (https://github.com/Ziuziuk-Denys/Nuvo)");
/// Past this the stream is another cut of the song, and lyrics timed for one drift on the other.
pub const DURATION_TOLERANCE_MS: i64 = 2000;
const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub enum LyricsError {
    #[error("lrclib request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("lrclib answered {0}")]
    Status(u16),
    #[error("the word lyrics index answered {0}")]
    Index(u16),
    #[error("lrclib asked to wait")]
    Waiting,
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
    #[serde(default)]
    has_word_sync: bool,
    #[serde(default)]
    lyricsfile: Option<String>,
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
    paused_until: Mutex<Option<Instant>>,
}

impl Lrclib {
    pub fn new(base: impl Into<String>) -> Self {
        Self::with_proxy(base, None)
    }

    pub fn with_proxy(base: impl Into<String>, proxy: Option<reqwest::Proxy>) -> Self {
        let mut builder = reqwest::Client::builder().user_agent(USER_AGENT).timeout(Duration::from_secs(10));
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Self { client, base: base.into().trim_end_matches('/').to_string(), paused_until: Mutex::new(None) }
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
        Ok(match pick(&records, query.duration_ms) {
            Some(record) => to_lookup(record, 0.8),
            None => other_cut(&records).map_or(Lookup::NotFound, as_plain),
        })
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<reqwest::Response, LyricsError> {
        if self.paused_until.lock().expect("lrclib pause").is_some_and(|until| Instant::now() < until) {
            return Err(LyricsError::Waiting);
        }
        let response = request.send().await?;
        if matches!(response.status().as_u16(), 429 | 503) {
            let wait = retry_after(response.headers()).unwrap_or(DEFAULT_RETRY_AFTER);
            *self.paused_until.lock().expect("lrclib pause") = Some(Instant::now() + with_jitter(wait));
            return Err(LyricsError::Status(response.status().as_u16()));
        }
        Ok(response)
    }

    async fn get(&self, query: &Query, duration_ms: i64) -> Result<Option<Record>, LyricsError> {
        let seconds = ((duration_ms as f64) / 1000.0).round().to_string();
        let request = self
            .client
            .get(format!("{}/api/get", self.base))
            .query(&[("track_name", query.title.as_str()), ("artist_name", query.artist.as_str()), ("duration", seconds.as_str())]);
        let response = self.send(request).await?;
        match response.status().as_u16() {
            200 => Ok(Some(response.json().await?)),
            // The exact endpoint times out on LRCLIB's side now and then; the search may still answer.
            404 | 500..=599 => Ok(None),
            status => Err(LyricsError::Status(status)),
        }
    }

    async fn search(&self, query: &Query) -> Result<Vec<Record>, LyricsError> {
        let request = self.client.get(format!("{}/api/search", self.base)).query(&[("track_name", query.title.as_str()), ("artist_name", query.artist.as_str())]);
        let response = self.send(request).await?;
        match response.status().as_u16() {
            200 => Ok(response.json().await?),
            status => Err(LyricsError::Status(status)),
        }
    }
}

fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let seconds: u64 = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?.trim().parse().ok()?;
    Some(Duration::from_secs(seconds.clamp(1, 3600)))
}

/// Up to 30% more, so throttled players do not all come back at once.
fn with_jitter(wait: Duration) -> Duration {
    let noise = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.subsec_nanos()) % 300;
    wait + wait * noise / 1000
}

fn has_lyrics(record: &Record) -> bool {
    record.synced().is_some() || record.plain().is_some()
}

fn pick(records: &[Record], duration_ms: Option<i64>) -> Option<&Record> {
    let close_enough = |record: &Record| match (duration_ms, record.duration_ms()) {
        (Some(want), Some(have)) => (want - have).abs() <= DURATION_TOLERANCE_MS,
        _ => true,
    };
    let usable: Vec<&Record> = records.iter().filter(|r| close_enough(r) && (r.instrumental || has_lyrics(r))).collect();
    usable.iter().find(|r| r.synced().is_some()).or_else(|| usable.first()).copied()
}

/// Words of a record cut to another length still read right; its timing would not fit.
fn other_cut(records: &[Record]) -> Option<&Record> {
    records.iter().find(|r| !r.instrumental && has_lyrics(r))
}

fn as_plain(record: &Record) -> Lookup {
    let text = record.plain().map(str::to_string).or_else(|| record.synced().map(lrc_text));
    let Some(text) = text.filter(|text| !text.trim().is_empty()) else { return Lookup::NotFound };
    let plain = Record { synced_lyrics: None, has_word_sync: false, plain_lyrics: Some(text), ..record.clone() };
    to_lookup(&plain, 0.5)
}

fn lrc_text(lrc: &str) -> String {
    let lines = lrc.lines().map(|line| {
        let mut rest = line.trim();
        while let Some(end) = rest.strip_prefix('[').and_then(|tail| tail.find(']')) {
            rest = rest[end + 2..].trim_start();
        }
        rest
    });
    lines.collect::<Vec<_>>().join("\n").trim().to_string()
}

fn to_lookup(record: &Record, match_score: f64) -> Lookup {
    let words = record.has_word_sync.then(|| record.lyricsfile.as_deref().and_then(lyricsfile::word_lrc)).flatten();
    let (format, content_kind, sync_level, content, total, sync) = if let Some(lrc) = words.as_deref() {
        ("lrc", "word_synced", "word_level", lrc, 0.85, 1.0)
    } else if let Some(lrc) = record.synced() {
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
        made: None,
    }))
}
