use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nuvo_net::{Fetch, Fetched, Net, NetError, Url};
use serde_json::Value;
use tokio::sync::Semaphore;

use crate::ScError;
use crate::play::Playable;

pub const WEB_URL: &str = "https://soundcloud.com/";
pub const API_URL: &str = "https://api-v2.soundcloud.com/";
const ASSET_HOST: &str = "a-v2.sndcdn.com/assets/";
const RECORD_TTL: Duration = Duration::from_secs(600);
const RECORD_CAP: usize = 500;
const API_MAX_BYTES: usize = 5 * 1024 * 1024;
const SCRIPT_MAX_BYTES: usize = 8 * 1024 * 1024;

pub fn host_allowed(host: &str) -> bool {
    matches!(
        host,
        "soundcloud.com"
            | "on.soundcloud.com"
            | "a-v2.sndcdn.com"
            | "api-v2.soundcloud.com"
            | "cf-media.sndcdn.com"
            | "cf-hls-media.sndcdn.com"
            | "cf-hls-opus-media.sndcdn.com"
            | "playback.media-streaming.soundcloud.cloud"
    )
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub api_timeout: Duration,
    pub discovery_timeout: Duration,
    pub segment_timeout: Duration,
    pub max_retry_wait: Duration,
}

impl Limits {
    pub const SOUNDCLOUD: Limits = Limits {
        api_timeout: Duration::from_secs(10),
        discovery_timeout: Duration::from_secs(15),
        segment_timeout: Duration::from_secs(20),
        max_retry_wait: Duration::from_secs(10),
    };
}

type Persist = Arc<dyn Fn(&str) + Send + Sync>;

struct Records {
    entries: HashMap<String, (Instant, u64, Value)>,
    clock: u64,
}

impl Records {
    fn get(&mut self, key: &str) -> Option<Value> {
        self.clock += 1;
        let clock = self.clock;
        match self.entries.get_mut(key) {
            Some((at, used, value)) if at.elapsed() < RECORD_TTL => {
                *used = clock;
                Some(value.clone())
            }
            _ => None,
        }
    }

    fn put(&mut self, key: String, value: Value) {
        let size = serde_json::to_string(&value).unwrap_or_default().len();
        if size > 512 * 1024 {
            return;
        }
        self.clock += 1;
        self.entries.insert(key, (Instant::now(), self.clock, value));
        if self.entries.len() > RECORD_CAP
            && let Some(oldest) = self.entries.iter().min_by_key(|(_, (_, used, _))| *used).map(|(k, _)| k.clone())
        {
            self.entries.remove(&oldest);
        }
    }
}

pub(crate) struct Inner {
    pub(crate) net: Net,
    pub(crate) limits: Limits,
    client_id: Mutex<Option<String>>,
    discovery: tokio::sync::Mutex<()>,
    last_failure: Mutex<Option<Instant>>,
    api_slots: Semaphore,
    records: Mutex<Records>,
    persist: Mutex<Option<Persist>>,
    pub(crate) direct: Mutex<HashMap<u64, Playable>>,
}

#[derive(Clone)]
pub struct SoundCloud {
    pub(crate) inner: Arc<Inner>,
}

impl SoundCloud {
    pub fn new(net: Net, limits: Limits) -> Self {
        Self {
            inner: Arc::new(Inner {
                net,
                limits,
                client_id: Mutex::new(None),
                discovery: tokio::sync::Mutex::new(()),
                last_failure: Mutex::new(None),
                api_slots: Semaphore::new(4),
                records: Mutex::new(Records { entries: HashMap::new(), clock: 0 }),
                persist: Mutex::new(None),
                direct: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn set_client_id(&self, id: Option<String>) {
        *self.inner.client_id.lock().unwrap() = id;
    }

    pub fn client_id(&self) -> Option<String> {
        self.inner.client_id.lock().unwrap().clone()
    }

    pub fn on_client_id(&self, persist: impl Fn(&str) + Send + Sync + 'static) {
        *self.inner.persist.lock().unwrap() = Some(Arc::new(persist));
    }

    pub(crate) fn fetch(&self, max_bytes: usize, timeout: Duration, accept: &'static str) -> Fetch {
        Fetch { allow: host_allowed, max_bytes, timeout, max_redirects: 3, accept }
    }

    pub(crate) async fn get_url(&self, url: &Url, max_bytes: usize, timeout: Duration) -> Result<Fetched, ScError> {
        self.inner.net.get(url, &self.fetch(max_bytes, timeout, "*/*")).await.map_err(ScError::from)
    }

    async fn ensure_client_id(&self) -> Result<String, ScError> {
        if let Some(id) = self.client_id() {
            return Ok(id);
        }
        self.rediscover(None).await
    }

    // rejected is forgotten only if it is still the current id
    async fn rediscover(&self, rejected: Option<&str>) -> Result<String, ScError> {
        let _flight = self.inner.discovery.lock().await;
        if let Some(last) = *self.inner.last_failure.lock().unwrap()
            && last.elapsed() < Duration::from_secs(5)
        {
            return Err(ScError::Unavailable);
        }
        {
            let mut current = self.inner.client_id.lock().unwrap();
            match (current.as_deref(), rejected) {
                (Some(id), Some(bad)) if id == bad => *current = None,
                (Some(id), _) => return Ok(id.to_string()),
                _ => {}
            }
        }
        let found = tokio::time::timeout(self.inner.limits.discovery_timeout, self.discover()).await.ok().flatten();
        match found {
            Some(id) => {
                *self.inner.client_id.lock().unwrap() = Some(id.clone());
                let persist = self.inner.persist.lock().unwrap().clone();
                if let Some(persist) = persist {
                    persist(&id);
                }
                Ok(id)
            }
            None => {
                *self.inner.last_failure.lock().unwrap() = Some(Instant::now());
                Err(ScError::Unavailable)
            }
        }
    }

    async fn discover(&self) -> Option<String> {
        let timeout = self.inner.limits.api_timeout;
        let home = self.inner.net.get(&Url::parse(WEB_URL).unwrap(), &self.fetch(API_MAX_BYTES, timeout, "text/html")).await.ok().filter(Fetched::ok)?;
        let html = String::from_utf8_lossy(&home.body);
        let scripts = script_urls(&html);
        for script in scripts.iter().rev().take(16) {
            let Ok(url) = Url::parse(script) else { continue };
            let Ok(body) = self.inner.net.get(&url, &self.fetch(SCRIPT_MAX_BYTES, timeout, "*/*")).await else { continue };
            if body.ok()
                && let Some(id) = find_client_id(&String::from_utf8_lossy(&body.body))
            {
                return Some(id);
            }
        }
        None
    }

    pub(crate) async fn api(&self, path: &str, params: &[(&str, String)]) -> Result<Value, ScError> {
        let base = Url::parse(API_URL).unwrap();
        let url = base.join(path).map_err(|e| ScError::Upstream(e.to_string()))?;
        if url.scheme() != "https" || url.host_str() != Some("api-v2.soundcloud.com") {
            return Err(ScError::Invalid(path.to_string()));
        }
        let mut id = self.ensure_client_id().await?;
        let mut retried_id = false;
        let mut retried_wait = false;
        loop {
            let response = self.send_api(&with_params(&url, params, &id)).await?;
            let retry_after = response.header("retry-after").and_then(|v| v.trim().parse::<u64>().ok());
            match response.status {
                401 | 403 if !retried_id => {
                    retried_id = true;
                    match self.rediscover(Some(&id)).await {
                        Ok(new_id) if new_id != id => id = new_id,
                        _ => return Err(ScError::Status(response.status)),
                    }
                }
                404 => return Err(ScError::NotFound),
                429 | 503 if !retried_wait && retry_after.is_some() => {
                    retried_wait = true;
                    let secs = retry_after.unwrap_or(0);
                    tokio::time::sleep(Duration::from_secs(secs).min(self.inner.limits.max_retry_wait)).await;
                }
                429 => return Err(ScError::RateLimited),
                status if !(200..300).contains(&status) => return Err(ScError::Status(status)),
                _ => {
                    *self.inner.client_id.lock().unwrap() = Some(id);
                    let value: Value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
                    if !(value.is_object() || value.is_array()) {
                        return Err(ScError::Upstream("SoundCloud returned no data".into()));
                    }
                    return Ok(value);
                }
            }
        }
    }

    async fn send_api(&self, url: &Url) -> Result<Fetched, ScError> {
        let _slot = self.inner.api_slots.acquire().await.expect("semaphore is never closed");
        self.inner.net.get(url, &self.fetch(API_MAX_BYTES, self.inner.limits.api_timeout, "application/json")).await.map_err(ScError::from)
    }

    pub(crate) async fn record(&self, path: &str, params: &[(&str, String)]) -> Result<Value, ScError> {
        let key = format!("{path}?{params:?}");
        if let Some(hit) = self.inner.records.lock().unwrap().get(&key) {
            return Ok(hit);
        }
        let value = self.api(path, params).await?;
        self.inner.records.lock().unwrap().put(key, value.clone());
        Ok(value)
    }
}

fn with_params(url: &Url, params: &[(&str, String)], client_id: &str) -> Url {
    let mut url = url.clone();
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| k != "client_id" && !params.iter().any(|(p, _)| p == k))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    {
        let mut query = url.query_pairs_mut();
        query.clear();
        for (k, v) in &kept {
            query.append_pair(k, v);
        }
        for (k, v) in params {
            query.append_pair(k, v);
        }
        query.append_pair("client_id", client_id);
    }
    url
}

pub fn script_urls(html: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut from = 0;
    while let Some(at) = html[from..].find(ASSET_HOST).map(|i| from + i) {
        from = at + ASSET_HOST.len();
        let head = &html[..at];
        let start = if head.ends_with("https://") { at - 8 } else if head.ends_with("//") { at - 2 } else { continue };
        let end = html[at..].find(|c: char| c == '"' || c == '\'' || c == '>' || c.is_whitespace()).map_or(html.len(), |i| at + i);
        let raw = &html[start..end];
        if !raw.ends_with(".js") {
            continue;
        }
        let url = if raw.starts_with("//") { format!("https:{raw}") } else { raw.to_string() };
        if !found.contains(&url) {
            found.push(url);
        }
    }
    found
}

pub fn find_client_id(script: &str) -> Option<String> {
    let mut from = 0;
    while let Some(at) = script[from..].find("client_id").map(|i| from + i) {
        from = at + "client_id".len();
        let rest = script[from..].trim_start();
        let Some(rest) = rest.strip_prefix(':').or_else(|| rest.strip_prefix('=')) else { continue };
        let Some(rest) = rest.trim_start().strip_prefix('"') else { continue };
        let value: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        if value.len() == 32 && rest[32..].starts_with('"') {
            return Some(value);
        }
    }
    None
}

impl From<NetError> for ScError {
    fn from(err: NetError) -> Self {
        match err {
            NetError::Timeout => ScError::Timeout,
            other => ScError::Upstream(other.to_string()),
        }
    }
}
