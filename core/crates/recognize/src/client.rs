//! Client for Shazam's recognition endpoint (the iPhone variant ShazamIO uses).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::limiter::{Limiter, Pace};
use crate::signature::Signature;
use crate::track::Song;

pub const SHAZAM_URL: &str = "https://amp.shazam.com";
/// Only app-like user agents get JSON back; a browser one gets HTML or 405.
const USER_AGENT: &str = "Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)";
const QUERY: [(&str, &str); 9] = [
    ("sync", "true"),
    ("webv3", "true"),
    ("sampling", "true"),
    ("connected", ""),
    ("shazamapiversion", "v3"),
    ("sharehub", "true"),
    ("hubv5minorversion", "v5.1"),
    ("hidelb", "true"),
    ("video", "v3"),
];

#[derive(Debug, thiserror::Error)]
pub enum ShazamError {
    #[error("shazam request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("shazam answered {0}")]
    Status(u16),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    Found(Box<Song>),
    NotFound,
    RateLimited,
}

pub struct Shazam {
    client: reqwest::Client,
    base: String,
    limiter: Limiter,
    pub pace: Pace,
}

impl Shazam {
    pub fn new(base: impl Into<String>, pace: Pace) -> Self {
        Self::with_proxy(base, pace, None)
    }

    pub fn with_proxy(base: impl Into<String>, pace: Pace, proxy: Option<reqwest::Proxy>) -> Self {
        let mut builder = reqwest::Client::builder().user_agent(USER_AGENT).connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(20));
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Self { client, base: base.into().trim_end_matches('/').to_string(), limiter: Limiter::new(pace), pace }
    }

    pub async fn send(&self, signature: &Signature) -> Result<Reply, ShazamError> {
        self.limiter.run(self.post(signature)).await
    }

    pub async fn wait(&self) -> Duration {
        self.limiter.wait().await
    }

    pub async fn defer(&self, wait: Duration) {
        self.limiter.defer(wait).await;
    }

    async fn post(&self, signature: &Signature) -> Result<Reply, ShazamError> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        let url = format!(
            "{}/discovery/v5/en-US/GB/iphone/-/tag/{}/{}",
            self.base,
            uuid_v4().to_uppercase(),
            uuid_v4().to_uppercase()
        );
        let body = json!({
            "timezone": "Europe/Moscow",
            "signature": { "uri": signature.data_uri(), "samplems": signature.duration_ms() },
            "timestamp": now,
            "context": {},
            "geolocation": {},
        });
        let response = self
            .client
            .post(url)
            .query(&QUERY)
            .header("X-Shazam-Platform", "IPHONE")
            .header("X-Shazam-AppVersion", "14.1.0")
            .header("Accept-Language", "en-US")
            .json(&body)
            .send()
            .await?;
        match response.status().as_u16() {
            200 => Ok(parse(&response.json::<Value>().await?)),
            429 => Ok(Reply::RateLimited),
            status => Err(ShazamError::Status(status)),
        }
    }
}

pub fn uuid_v4() -> String {
    let mut b: [u8; 16] = nuvo_crypto::random_bytes();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = nuvo_crypto::to_hex(&b);
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

fn parse(body: &Value) -> Reply {
    let track = &body["track"];
    let text = |value: &Value| value.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let (Some(title), Some(artist), Some(shazam_key)) = (text(&track["title"]), text(&track["subtitle"]), text(&track["key"])) else {
        return Reply::NotFound;
    };
    let metadata = |name: &str| {
        track["sections"]
            .as_array()?
            .iter()
            .filter(|section| section["type"] == "SONG")
            .flat_map(|section| section["metadata"].as_array().into_iter().flatten())
            .find(|entry| entry["title"] == name)
            .and_then(|entry| text(&entry["text"]))
    };
    let cover_url = text(&track["images"]["coverarthq"])
        .or_else(|| text(&track["images"]["coverart"]))
        .map(|url| url.replace("400x400", "600x600"));
    let apple_music_url = track["hub"]["options"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|option| option["actions"].as_array().into_iter().flatten())
        .filter_map(|action| action["uri"].as_str())
        .find(|uri| uri.starts_with("https://music.apple.com/"))
        .map(|uri| uri.split('&').next().unwrap_or(uri).to_string());
    let preview_url = track["hub"]["actions"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|action| action["type"] == "uri")
        .and_then(|action| text(&action["uri"]));
    let offset_seconds = body["matches"][0]["offset"].as_f64().unwrap_or(0.0).max(0.0);
    Reply::Found(Box::new(Song {
        title,
        artist,
        album: metadata("Album"),
        released: metadata("Released"),
        genre: text(&track["genres"]["primary"]),
        isrc: text(&track["isrc"]),
        cover_url,
        apple_music_url,
        preview_url,
        shazam_key,
        offset_ms: (offset_seconds * 1000.0).round() as u64,
    }))
}
