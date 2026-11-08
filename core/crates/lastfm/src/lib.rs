//! Last.fm client: desktop auth, now playing and batched scrobbles, every call signed with `api_sig`.

use std::fmt;
use std::time::Duration;

use md5::{Digest, Md5};
use serde_json::Value;

pub const LASTFM_URL: &str = "https://ws.audioscrobbler.com/2.0/";
pub const AUTH_URL: &str = "https://www.last.fm/api/auth/";
/// `track.scrobble` accepts at most this many plays per request.
pub const MAX_BATCH: usize = 50;
pub const RATE_LIMIT: i64 = 29;
pub const INVALID_PARAMETERS: i64 = 6;
pub const INVALID_SESSION: i64 = 9;
pub const TOKEN_NOT_AUTHORIZED: i64 = 14;
pub const SERVICE_OFFLINE: i64 = 11;
pub const TEMPORARILY_UNAVAILABLE: i64 = 16;
pub const AUTH_FAILED: i64 = 4;
pub const INVALID_API_KEY: i64 = 10;
pub const INVALID_SIGNATURE: i64 = 13;
pub const SUSPENDED_API_KEY: i64 = 26;

#[derive(Debug, thiserror::Error)]
pub enum LastfmError {
    #[error("last.fm request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("last.fm error {code}: {message}")]
    Api { code: i64, message: String },
    #[error("last.fm answered {0}")]
    Status(u16),
    #[error("last.fm sent an unexpected response")]
    Malformed,
    #[error("batch must be non-empty and at most {MAX_BATCH} items")]
    InvalidBatch,
}

impl LastfmError {
    /// The key, secret or signature is refused; only new credentials or a new session can fix it.
    pub fn is_permanent_auth(&self) -> bool {
        matches!(self, LastfmError::Api { code: AUTH_FAILED | INVALID_API_KEY | INVALID_SIGNATURE | SUSPENDED_API_KEY, .. })
    }

    pub fn is_retryable(&self) -> bool {
        match self {
            LastfmError::Api { code, .. } => matches!(*code, SERVICE_OFFLINE | TEMPORARILY_UNAVAILABLE | RATE_LIMIT),
            LastfmError::Http(_) => true,
            LastfmError::Status(code) => code / 100 == 5,
            _ => false,
        }
    }
}

pub struct Credentials {
    pub api_key: String,
    pub api_secret: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrackInfo {
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub duration_s: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Scrobble {
    pub track: TrackInfo,
    /// Unix seconds when the play started.
    pub timestamp: i64,
}

#[derive(Clone, PartialEq)]
pub struct Session {
    pub name: String,
    pub key: String,
}

impl fmt::Debug for Session {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Session")
            .field("name", &self.name)
            .field("key", &"<redacted>")
            .finish()
    }
}

/// md5 hex of the parameters sorted by name and joined as `<name><value>`, followed by the
/// secret. `format` and `callback` are not part of the signature.
pub fn sign(params: &[(String, String)], secret: &str) -> String {
    let mut signed: Vec<&(String, String)> = params.iter().filter(|(name, _)| name != "format" && name != "callback").collect();
    signed.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Md5::new();
    for (name, value) in signed {
        hasher.update(name.as_bytes());
        hasher.update(value.as_bytes());
    }
    hasher.update(secret.as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Page where the user approves the token. Keys and tokens are alphanumeric, so no escaping.
pub fn auth_url(api_key: &str, token: &str) -> String {
    format!("{AUTH_URL}?api_key={api_key}&token={token}")
}

fn track_params(params: &mut Vec<(String, String)>, track: &TrackInfo, suffix: &str) {
    params.push((format!("artist{suffix}"), track.artist.clone()));
    params.push((format!("track{suffix}"), track.track.clone()));
    if let Some(album) = &track.album {
        params.push((format!("album{suffix}"), album.clone()));
    }
    if let Some(duration) = track.duration_s {
        params.push((format!("duration{suffix}"), duration.to_string()));
    }
}

pub struct Lastfm {
    client: reqwest::Client,
    base: String,
}

impl Lastfm {
    /// Create a client with a custom base URL for testing. Production code should use `official()`.
    pub fn new(base: impl Into<String>) -> Self {
        Self::with_proxy(base, None)
    }

    /// Like [`Lastfm::new`], with every request sent through `proxy`.
    pub fn with_proxy(base: impl Into<String>, proxy: Option<reqwest::Proxy>) -> Self {
        let mut builder = reqwest::Client::builder().user_agent("nuvo-core/0.1 (personal music player)").timeout(Duration::from_secs(15));
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Self { client, base: base.into() }
    }

    /// Create a client connected to the official Last.fm API.
    pub fn official() -> Self {
        Self::new(LASTFM_URL)
    }

    pub async fn get_token(&self, creds: &Credentials) -> Result<String, LastfmError> {
        let body = self.call(creds, "auth.getToken", Vec::new()).await?;
        body["token"].as_str().map(str::to_string).ok_or(LastfmError::Malformed)
    }

    pub async fn get_session(&self, creds: &Credentials, token: &str) -> Result<Session, LastfmError> {
        let body = self.call(creds, "auth.getSession", vec![("token".into(), token.into())]).await?;
        let session = &body["session"];
        match (session["name"].as_str(), session["key"].as_str()) {
            (Some(name), Some(key)) => Ok(Session { name: name.into(), key: key.into() }),
            _ => Err(LastfmError::Malformed),
        }
    }

    pub async fn now_playing(&self, creds: &Credentials, session_key: &str, track: &TrackInfo) -> Result<(), LastfmError> {
        let mut params = vec![("sk".to_string(), session_key.to_string())];
        track_params(&mut params, track, "");
        self.call(creds, "track.updateNowPlaying", params).await.map(|_| ())
    }

    /// Sends up to `MAX_BATCH` plays in one request; the caller splits larger queues.
    /// Returns (accepted, ignored) counts from the response.
    pub async fn scrobble(&self, creds: &Credentials, session_key: &str, batch: &[Scrobble]) -> Result<(i64, i64), LastfmError> {
        if batch.is_empty() || batch.len() > MAX_BATCH {
            return Err(LastfmError::InvalidBatch);
        }
        let mut params = vec![("sk".to_string(), session_key.to_string())];
        for (index, play) in batch.iter().enumerate() {
            let suffix = format!("[{index}]");
            track_params(&mut params, &play.track, &suffix);
            params.push((format!("timestamp{suffix}"), play.timestamp.to_string()));
        }
        let body = self.call(creds, "track.scrobble", params).await?;
        let attr = &body["scrobbles"]["@attr"];
        let accepted = attr["accepted"].as_i64().unwrap_or(0);
        let ignored = attr["ignored"].as_i64().unwrap_or(0);
        Ok((accepted, ignored))
    }

    async fn call(&self, creds: &Credentials, method: &str, mut params: Vec<(String, String)>) -> Result<Value, LastfmError> {
        params.push(("method".into(), method.into()));
        params.push(("api_key".into(), creds.api_key.clone()));
        let signature = sign(&params, &creds.api_secret);
        params.push(("api_sig".into(), signature));
        params.push(("format".into(), "json".into()));
        // POST keeps the key and session out of URLs (and so out of any error text that quotes one).
        let response = self.client.post(&self.base).form(&params).send().await?;
        let status = response.status().as_u16();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if let Some(code) = body["error"].as_i64() {
            let message = body["message"].as_str().unwrap_or_default().to_string();
            return Err(LastfmError::Api { code, message });
        }
        if status != 200 {
            return Err(LastfmError::Status(status));
        }
        Ok(body)
    }
}
