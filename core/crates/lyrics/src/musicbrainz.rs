// MusicBrainz open data: the lengths of the recordings behind an ISRC, at most one request a second

use std::collections::HashMap;
use std::time::Duration;

use reqwest::Url;
use serde::Deserialize;
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::USER_AGENT;

pub const MUSICBRAINZ_URL: &str = "https://musicbrainz.org";
const ALLOWED_HOST: &str = "musicbrainz.org";
const GAP: Duration = Duration::from_secs(1);
// shortcut: the cache forgets everything at this size, enough for one session of listening
const MAX_CACHED: usize = 2000;

#[derive(Deserialize)]
struct IsrcAnswer {
    #[serde(default)]
    recordings: Vec<Recording>,
}

#[derive(Deserialize)]
struct Recording {
    #[serde(default)]
    length: Option<i64>,
}

pub struct MusicBrainz {
    client: reqwest::Client,
    base: String,
    next: Mutex<Instant>,
    lengths: Mutex<HashMap<String, Vec<i64>>>,
}

fn allowed(base: &str) -> bool {
    let Ok(url) = Url::parse(base) else { return false };
    if url.host_str() == Some("127.0.0.1") {
        return true;
    }
    url.scheme() == "https" && url.host_str() == Some(ALLOWED_HOST) && url.port().is_none() && url.username().is_empty() && url.password().is_none()
}

fn valid_isrc(isrc: &str) -> bool {
    let bytes = isrc.as_bytes();
    bytes.len() == 12 && bytes[..2].iter().all(u8::is_ascii_uppercase) && bytes[2..5].iter().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) && bytes[5..].iter().all(u8::is_ascii_digit)
}

impl MusicBrainz {
    pub fn with_proxy(base: &str, proxy: Option<reqwest::Proxy>) -> Option<Self> {
        if !allowed(base) {
            return None;
        }
        let mut builder = reqwest::Client::builder().user_agent(USER_AGENT).timeout(Duration::from_secs(10));
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Some(Self { client, base: base.trim_end_matches('/').to_string(), next: Mutex::new(Instant::now()), lengths: Mutex::new(HashMap::new()) })
    }

    /// Lengths in ms of the recordings with this ISRC; None when MusicBrainz could not be asked.
    pub async fn isrc_lengths(&self, isrc: &str) -> Option<Vec<i64>> {
        if !valid_isrc(isrc) {
            return None;
        }
        if let Some(known) = self.lengths.lock().await.get(isrc) {
            return Some(known.clone());
        }
        self.wait_turn().await;
        let url = format!("{}/ws/2/isrc/{isrc}", self.base);
        let response = self.client.get(url).query(&[("fmt", "json")]).send().await.ok()?;
        let lengths: Vec<i64> = match response.status().as_u16() {
            200 => response.json::<IsrcAnswer>().await.ok()?.recordings.into_iter().filter_map(|r| r.length).filter(|ms| *ms > 0).collect(),
            404 => Vec::new(),
            _ => return None,
        };
        let mut cache = self.lengths.lock().await;
        if cache.len() >= MAX_CACHED {
            cache.clear();
        }
        cache.insert(isrc.to_string(), lengths.clone());
        Some(lengths)
    }

    async fn wait_turn(&self) {
        let mut next = self.next.lock().await;
        tokio::time::sleep_until(*next).await;
        *next = Instant::now() + GAP;
    }
}
