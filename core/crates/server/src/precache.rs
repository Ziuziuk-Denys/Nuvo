//! Pre-cache: the daemon downloads one upcoming track's stream into the encrypted cache, so the
//! renderer never holds the whole track. Only `https` URLs on the playback hosts are fetched,
//! in ranges of at most 10 MB (googlevideo throttles unranged reads), through the proxy.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use nuvo_contracts::{FetchRequest, FetchStatus};
use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_store::now_ms;
use reqwest::header::{CONTENT_RANGE, RANGE};
use reqwest::{StatusCode, Url};
use tokio::sync::watch;

use crate::error::ApiError;
use crate::routes::cache::{MAX_UPLOAD_BYTES, evict};
use crate::state::{AppState, Unlocked};

pub const RANGE_BYTES: u64 = 10 * 1024 * 1024;
/// shortcut: a whole 10 MB range must arrive within this; an idle-read timeout would suit slow links better.
const RANGE_TIMEOUT: Duration = Duration::from_secs(120);
/// Overall timeout per job to prevent indefinite hangs.
const JOB_TIMEOUT: Duration = Duration::from_secs(600);
/// Maximum concurrent fetches; extras return 429 until one completes.
const MAX_CONCURRENT_FETCHES: usize = 2;
/// Redirects followed per job.
const MAX_REDIRECTS: usize = 3;
/// Finished jobs kept for status reads; older ones are forgotten first.
const KEEP_FINISHED: usize = 50;

pub struct Job {
    pub status: FetchStatus,
    cancel: Option<watch::Sender<bool>>,
    finished_at: Option<i64>,
    generation: u64,
}

#[derive(Default)]
pub struct Jobs {
    inner: Mutex<HashMap<String, Job>>,
    next_gen: AtomicU64,
}

/// What `reserve` decided, all under one lock.
enum Reservation {
    /// The track already has a running job.
    Running(FetchStatus),
    Full,
    Started(u64, watch::Receiver<bool>),
}

impl Jobs {
    pub fn status(&self, track_id: &str) -> Option<FetchStatus> {
        self.inner.lock().expect("fetch jobs").get(track_id).map(|job| job.status.clone())
    }

    fn update(&self, track_id: &str, generation: u64, change: impl FnOnce(&mut FetchStatus)) {
        let mut jobs = self.inner.lock().expect("fetch jobs");
        if let Some(job) = jobs.get_mut(track_id) && job.generation == generation {
            change(&mut job.status);
        }
    }

    /// Ends a job unless it was cancelled or replaced meanwhile.
    fn finish(&self, track_id: &str, generation: u64, state: &'static str, code: Option<&'static str>) {
        let mut jobs = self.inner.lock().expect("fetch jobs");
        if let Some(job) = jobs.get_mut(track_id) && job.generation == generation {
            job.status.state = state;
            job.status.code = code;
            job.cancel = None;
            job.finished_at = Some(now_ms());
        }
        let mut finished: Vec<(i64, String)> = jobs.iter().filter_map(|(id, job)| job.finished_at.map(|at| (at, id.clone()))).collect();
        if finished.len() > KEEP_FINISHED {
            finished.sort();
            for (_, id) in &finished[..finished.len() - KEEP_FINISHED] {
                jobs.remove(id);
            }
        }
    }

    /// Joins a running job of the track, or inserts a new one (replacing a finished entry) when a slot is
    /// free. The running count is read from the map, so it cannot drift.
    fn reserve(&self, track_id: &str) -> Reservation {
        let mut jobs = self.inner.lock().expect("fetch jobs");
        if let Some(job) = jobs.get(track_id) && job.finished_at.is_none() {
            return Reservation::Running(job.status.clone());
        }
        if jobs.values().filter(|job| job.finished_at.is_none()).count() >= MAX_CONCURRENT_FETCHES {
            return Reservation::Full;
        }
        let generation = self.next_gen.fetch_add(1, Ordering::SeqCst);
        let (cancel, cancelled) = watch::channel(false);
        let status = FetchStatus { state: "queued", bytes: 0, code: None };
        jobs.insert(track_id.to_string(), Job { status, cancel: Some(cancel), finished_at: None, generation });
        Reservation::Started(generation, cancelled)
    }

    /// Stops a fetch and forgets it; a running job removes its partial file itself.
    pub fn cancel(&self, track_id: &str) {
        let mut jobs = self.inner.lock().expect("fetch jobs");
        if let Some(job) = jobs.remove(track_id) && let Some(cancel) = job.cancel {
            let _ = cancel.send(true);
        }
    }
}

/// The playback hosts, plus hosts a test allows (those may use `http` and private addresses).
pub fn allowed_host(host: &str, test_hosts: &[String]) -> bool {
    host.ends_with(".googlevideo.com") || host.ends_with(".sndcdn.com") || host == "playback.media-streaming.soundcloud.cloud" || test_hosts.iter().any(|h| h == host)
}

/// A redirect target must be https on the default port, on the host list, without userinfo
/// (a test host may use plain http). Its addresses are checked when the client is built.
fn redirect_allowed(url: &Url, test_hosts: &[String]) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if test_hosts.contains(&host) {
        return true;
    }
    allowed_host(&host, test_hosts) && url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none()
}

/// Deny by default: `https`, no credentials, no port, a host name on the list, and every address
/// it resolves to public.
pub async fn check_url(text: &str, test_hosts: &[String]) -> Result<Url, ApiError> {
    let refuse = || ApiError::Invalid("only stream URLs of the playback hosts can be fetched".into());
    let url = Url::parse(text).map_err(|_| refuse())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let test_host = test_hosts.contains(&host);
    let ip_literal = host.trim_start_matches('[').trim_end_matches(']').parse::<std::net::IpAddr>().is_ok();
    if !allowed_host(&host, test_hosts) || !url.username().is_empty() || url.password().is_some() || (ip_literal && !test_host) {
        return Err(refuse());
    }
    if !test_host {
        if url.scheme() != "https" || url.port().is_some() {
            return Err(refuse());
        }
        nuvo_fetch::ensure_public(url.as_str()).await.map_err(|_| refuse())?;
    }
    Ok(url)
}

/// Starts a fetch unless the track is cached or already being fetched; answers the status.
pub async fn start(state: &AppState, data: Unlocked, request: FetchRequest) -> Result<(bool, FetchStatus), ApiError> {
    if request.content_length.is_some_and(|len| len > MAX_UPLOAD_BYTES) {
        return Err(ApiError::TooLarge);
    }
    let mime = request.mime.to_lowercase();
    if !mime.starts_with("audio/") && !mime.starts_with("video/") {
        return Err(ApiError::Invalid("mime must be audio/* or video/*".into()));
    }
    let url = check_url(&request.url, &state.test.fetch_hosts).await?;
    let id = request.track_id.clone();
    let cached = data.db.call(move |c| cache_index::get(c, &id)).await?.is_some();
    if cached && let Some(size) = data.cache.size(&request.track_id).await? {
        return Ok((false, FetchStatus { state: "done", bytes: size, code: None }));
    }

    let (generation, cancelled) = match state.fetches.reserve(&request.track_id) {
        Reservation::Running(status) => return Ok((true, status)),
        // Spec S3 has no 429 code; CONFLICT is the nearest existing one.
        Reservation::Full => return Err(ApiError::TooManyRequests),
        Reservation::Started(generation, cancelled) => (generation, cancelled),
    };
    tokio::spawn(run(state.clone(), data, request, mime, url, cancelled, generation));
    Ok((true, FetchStatus { state: "queued", bytes: 0, code: None }))
}

async fn run(state: AppState, data: Unlocked, request: FetchRequest, mime: String, url: Url, mut cancelled: watch::Receiver<bool>, generation: u64) {
    let id = request.track_id.clone();
    state.fetches.update(&id, generation, |s| s.state = "fetching");
    let outcome = download(&state, &data, &id, &url, &mut cancelled, generation).await;
    match outcome {
        Ok(None) => {}
        Ok(Some((path, size))) => {
            let entry = CacheEntry { track_id: id.clone(), path, size_bytes: size as i64, mime, codec: request.codec.filter(|c| c.len() <= 64) };
            let stored = data.db.call(move |c| cache_index::upsert(c, &entry, now_ms())).await;
            if stored.is_ok() {
                crate::downloads::poke(&state);
            }
            if let Err(err) = evict(&data, Some(&id)).await {
                tracing::warn!("cache eviction failed: {:?}", err);
            }
            match stored {
                Ok(()) => state.fetches.finish(&id, generation, "done", None),
                Err(_) => state.fetches.finish(&id, generation, "failed", Some("io")),
            }
        }
        Err(code) => {
            tracing::info!(code, "pre-cache failed");
            state.fetches.finish(&id, generation, "failed", Some(code));
        }
    }
}

/// `Content-Range: bytes first-last/size` as `(first, last, size)`.
fn parse_content_range(text: &str) -> Option<(u64, u64, u64)> {
    let (range, size) = text.strip_prefix("bytes ")?.split_once('/')?;
    let (first, last) = range.split_once('-')?;
    Some((first.parse().ok()?, last.parse().ok()?, size.parse().ok()?))
}

/// A client for one hop. Outside the test hosts and without a proxy it connects to the addresses
/// just checked as public, so a second DNS answer cannot point it elsewhere; a proxy resolves by itself.
async fn client_for(state: &AppState, url: &Url, test_hosts: &[String]) -> Result<reqwest::Client, &'static str> {
    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(10)).proxy(state.proxy_hook());
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !test_hosts.contains(&host) {
        let addresses = match nuvo_fetch::public_addresses(url.as_str()).await {
            Ok(addresses) => addresses,
            Err(nuvo_fetch::FetchError::Network(_)) => return Err("dns_failed"),
            Err(_) => return Err("blocked"),
        };
        if state.proxy().is_none() {
            builder = builder.resolve_to_addrs(&host, &addresses);
        }
    }
    builder.build().map_err(|_| "io")
}

/// `Ok(None)` when cancelled; `Err` carries the S3 code (plus `too_large`, `io` and `timeout`). Refused
/// redirects are `blocked`; a response that breaks the range protocol is `server_error`.
async fn download(state: &AppState, data: &Unlocked, id: &str, url: &Url, cancelled: &mut watch::Receiver<bool>, generation: u64) -> Result<Option<(String, u64)>, &'static str> {
    let test_hosts = state.test.fetch_hosts.clone();
    let mut writer = data.cache.begin(id).await.map_err(|_| "io")?;
    let mut current_url = url.clone();
    let limit = state.test.job_timeout.unwrap_or(JOB_TIMEOUT);

    // Under the time limit, so a timeout still reaches the abort below and the part file goes.
    let outcome: Result<bool, &'static str> = tokio::time::timeout(limit, async {
        let mut client = client_for(state, &current_url, &test_hosts).await?;
        let mut redirects = 0;
        let mut known_total: Option<u64> = None;
        loop {
            let start = writer.size();
            let request = client.get(current_url.clone()).header(RANGE, format!("bytes={start}-{}", start + RANGE_BYTES - 1)).timeout(RANGE_TIMEOUT);
            let mut response = tokio::select! {
                sent = request.send() => sent.map_err(|e| crate::netcheck::classify_error(&e, state.proxy().is_some()).0)?,
                _ = cancelled.changed() => return Ok(false),
            };

            let status = response.status();
            if status.is_redirection() {
                redirects += 1;
                let location = response.headers().get("location").and_then(|h| h.to_str().ok()).ok_or("blocked")?;
                let target = current_url.join(location).map_err(|_| "blocked")?;
                if redirects > MAX_REDIRECTS || !redirect_allowed(&target, &test_hosts) {
                    return Err("blocked");
                }
                client = client_for(state, &target, &test_hosts).await?;
                current_url = target;
                continue;
            }

            let ranged = match status {
                StatusCode::PARTIAL_CONTENT => true,
                StatusCode::OK => false,
                StatusCode::FORBIDDEN | StatusCode::GONE => return Err("unavailable"),
                _ => return Err(crate::netcheck::status_code(status.as_u16()).unwrap_or("unavailable")),
            };

            let total = if ranged {
                let header = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok());
                let (first, last, size) = header.and_then(parse_content_range).ok_or("server_error")?;
                if first != start || last < first || last >= size || known_total.is_some_and(|t| t != size) {
                    return Err("server_error");
                }
                known_total = Some(size);
                known_total
            } else if start > 0 {
                // A whole body cannot answer a later range.
                return Err("server_error");
            } else {
                response.content_length()
            };

            if total.is_some_and(|t| t > MAX_UPLOAD_BYTES) {
                return Err("too_large");
            }

            loop {
                let chunk = tokio::select! {
                    chunk = response.chunk() => chunk.map_err(|e| crate::netcheck::classify_error(&e, state.proxy().is_some()).0)?,
                    _ = cancelled.changed() => return Ok(false),
                };
                let Some(chunk) = chunk else { break };
                if writer.size() + chunk.len() as u64 > MAX_UPLOAD_BYTES {
                    return Err("too_large");
                }
                writer.write(&chunk).await.map_err(|_| "io")?;
                let bytes = writer.size();
                state.fetches.update(id, generation, |s| s.bytes = bytes);
            }

            // Done when the known total is reached, not when a range comes back short.
            let size = writer.size();
            match total {
                Some(t) if size == t => return Ok(true),
                Some(t) if size > t || size == start || !ranged => return Err("server_error"),
                Some(_) => {}
                None => return Ok(true),
            }
        }
    })
    .await
    .unwrap_or(Err("timeout"));

    match outcome {
        Ok(true) => {
            let finished = writer.finish().await.map_err(|_| "io")?;
            Ok(Some((finished.path.to_string_lossy().into_owned(), finished.size)))
        }
        Ok(false) => {
            writer.abort().await;
            Ok(None)
        }
        Err(code) => {
            writer.abort().await;
            Err(code)
        }
    }
}
