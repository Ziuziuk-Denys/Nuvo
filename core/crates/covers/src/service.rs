use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::FutureExt;
use futures::future::{BoxFuture, Shared, WeakShared};
use nuvo_cache::AudioCache;
use nuvo_crypto::sha256_hex;
use nuvo_net::{Fetch, Net, NetError, Url};
use nuvo_store::{Db, now_ms};
use tokio::sync::Semaphore;

use crate::index::{self, Entry};
use crate::picture::process;
use crate::source::{self, Cdn, Plan};
use crate::CoverError;

/// No AVIF: the image codecs Nuvo builds in are JPEG, PNG and WebP.
const ACCEPT: &str = "image/webp,image/jpeg,image/png,*/*;q=0.5";
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MEMORY_CAP_BYTES: usize = 16 * 1024 * 1024;
const NEGATIVE_CAP: usize = 1000;

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub timeout: Duration,
    pub negative_ttl: Duration,
}

impl Limits {
    pub const COVERS: Limits = Limits { timeout: Duration::from_secs(10), negative_ttl: Duration::from_secs(600) };
}

#[derive(Clone)]
pub struct Disk {
    pub db: Db,
    pub files: AudioCache,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cover {
    pub bytes: Vec<u8>,
    pub content_type: String,
    pub etag: String,
}

#[derive(Debug, Clone)]
pub struct Prepared {
    pub plan: Plan,
    pub bucket: u32,
    pub key: String,
    pub etag: String,
}

fn etag(key: &str) -> String {
    format!("\"{}\"", &sha256_hex(key.as_bytes())[..32])
}

fn cache_key(canonical: &str, bucket: u32) -> String {
    format!("{canonical}@{bucket}")
}

fn parse(url: &str, field: &str) -> Result<Url, CoverError> {
    let parsed = Url::parse(url.trim()).map_err(|_| CoverError::Invalid(format!("{field} is not a URL")))?;
    if parsed.scheme() != "https" {
        return Err(CoverError::Invalid(format!("{field} must be an https URL")));
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if parsed.port().is_some() || !source::host_allowed(&host) {
        return Err(CoverError::Forbidden(host));
    }
    Ok(parsed)
}

pub fn prepare(src: Option<&str>, alt: Option<&str>, size: Option<&str>) -> Result<Prepared, CoverError> {
    let src = src.map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| CoverError::Invalid("src is required".into()))?;
    let src = parse(src, "src")?;
    let alt = alt.map(str::trim).filter(|a| !a.is_empty()).map(|a| parse(a, "alt")).transpose()?;
    let bucket = source::bucket(size).ok_or_else(|| CoverError::Invalid("size must be a non-negative number".into()))?;
    let plan = source::plan(&src, alt.as_ref(), bucket).ok_or_else(|| CoverError::Forbidden(src.host_str().unwrap_or_default().into()))?;
    let key = cache_key(&plan.canonical, bucket);
    Ok(Prepared { etag: etag(&key), key, bucket, plan })
}

#[derive(Default)]
struct Memory {
    entries: HashMap<String, (Cover, u64)>,
    bytes: usize,
    clock: u64,
}

impl Memory {
    fn get(&mut self, key: &str) -> Option<Cover> {
        self.clock += 1;
        let clock = self.clock;
        self.entries.get_mut(key).map(|(cover, used)| {
            *used = clock;
            cover.clone()
        })
    }

    fn put(&mut self, key: String, cover: Cover) {
        self.clock += 1;
        self.bytes += cover.bytes.len();
        if let Some((old, _)) = self.entries.insert(key, (cover, self.clock)) {
            self.bytes -= old.bytes.len();
        }
        while self.bytes > MEMORY_CAP_BYTES {
            let Some(oldest) = self.entries.iter().min_by_key(|(_, (_, used))| *used).map(|(k, _)| k.clone()) else { break };
            if let Some((gone, _)) = self.entries.remove(&oldest) {
                self.bytes -= gone.bytes.len();
            }
        }
    }
}

type Fetching = BoxFuture<'static, Result<Cover, CoverError>>;
type Flight = Shared<Fetching>;

struct Inner {
    net: Net,
    limits: Limits,
    fetch_slots: Semaphore,
    decode_slots: Semaphore,
    /// Weak, so a fetch nobody waits for any more is dropped (and so aborted).
    flights: Mutex<HashMap<String, WeakShared<Fetching>>>,
    negative: Mutex<HashMap<String, Instant>>,
    memory: Mutex<Memory>,
}

#[derive(Clone)]
pub struct Covers {
    inner: Arc<Inner>,
}

impl Covers {
    pub fn new(net: Net, limits: Limits) -> Self {
        Self {
            inner: Arc::new(Inner {
                net,
                limits,
                fetch_slots: Semaphore::new(6),
                decode_slots: Semaphore::new(2),
                flights: Mutex::new(HashMap::new()),
                negative: Mutex::new(HashMap::new()),
                memory: Mutex::new(Memory::default()),
            }),
        }
    }

    pub async fn get(&self, req: &Prepared, disk: Option<Disk>) -> Result<Cover, CoverError> {
        if let Some(cover) = self.cached(&req.key, disk.as_ref()).await {
            return Ok(cover);
        }
        let negative = self.inner.negative.lock().unwrap().get(&req.key).is_some_and(|at| at.elapsed() < self.inner.limits.negative_ttl);
        let result = if negative { Err(CoverError::NotFound) } else { self.flight(req, disk.clone()).await };
        match result {
            Ok(cover) => Ok(cover),
            Err(err) => self.other_bucket(req, disk.as_ref()).await.ok_or(err),
        }
    }

    async fn cached(&self, key: &str, disk: Option<&Disk>) -> Option<Cover> {
        let Some(disk) = disk else { return self.inner.memory.lock().unwrap().get(key) };
        let lookup = key.to_string();
        let entry = disk.db.call(move |c| index::get(c, &lookup)).await.ok().flatten()?;
        read(disk, &entry).await
    }

    fn flight(&self, req: &Prepared, disk: Option<Disk>) -> Flight {
        let mut flights = self.inner.flights.lock().unwrap();
        if let Some(running) = flights.get(&req.key).and_then(WeakShared::upgrade) {
            return running;
        }
        let (this, req_owned) = (self.clone(), req.clone());
        let flight = async move {
            let result = this.fetch_and_store(&req_owned, disk).await;
            this.inner.flights.lock().unwrap().remove(&req_owned.key);
            result
        }
        .boxed()
        .shared();
        flights.insert(req.key.clone(), flight.downgrade().expect("a new shared future has not completed"));
        flight
    }

    async fn download(&self, plan: &Plan) -> Result<Vec<u8>, CoverError> {
        let _slot = self.inner.fetch_slots.acquire().await.expect("semaphore is never closed");
        let fetch = Fetch { allow: source::host_allowed, max_bytes: MAX_BODY_BYTES, timeout: self.inner.limits.timeout, max_redirects: 3, accept: ACCEPT };
        for url in &plan.variants {
            let response = self.inner.net.get(url, &fetch).await.map_err(|err| match err {
                NetError::Timeout => CoverError::Timeout,
                other => CoverError::Upstream(other.to_string()),
            })?;
            match response.status {
                404 => continue,
                200 if response.header("content-type").is_some_and(|t| t.trim().to_ascii_lowercase().starts_with("image/")) => return Ok(response.body),
                200 => return Err(CoverError::Upstream("the cover CDN did not return an image".into())),
                status => return Err(CoverError::Upstream(format!("the cover CDN answered {status}"))),
            }
        }
        Err(CoverError::NotFound)
    }

    async fn fetch_and_store(&self, req: &Prepared, disk: Option<Disk>) -> Result<Cover, CoverError> {
        let body = match self.download(&req.plan).await {
            Err(CoverError::NotFound) => {
                self.remember_missing(&req.key);
                return Err(CoverError::NotFound);
            }
            other => other?,
        };
        let processed = {
            let _slot = self.inner.decode_slots.acquire().await.expect("semaphore is never closed");
            let (bucket, video) = (req.bucket, req.plan.cdn == Cdn::YouTube);
            tokio::task::spawn_blocking(move || process(body, bucket, video)).await.map_err(|e| CoverError::Upstream(e.to_string()))??
        };
        let cover = Cover { bytes: processed.bytes, content_type: processed.content_type.to_string(), etag: req.etag.clone() };
        match disk {
            Some(disk) => {
                if let Err(err) = store(&disk, req, &cover).await {
                    tracing::warn!(%err, "cover not stored");
                }
            }
            None => self.inner.memory.lock().unwrap().put(req.key.clone(), cover.clone()),
        }
        Ok(cover)
    }

    fn remember_missing(&self, key: &str) {
        let mut negative = self.inner.negative.lock().unwrap();
        let ttl = self.inner.limits.negative_ttl;
        negative.retain(|_, at| at.elapsed() < ttl);
        if negative.len() >= NEGATIVE_CAP
            && let Some(oldest) = negative.iter().min_by_key(|(_, at)| **at).map(|(k, _)| k.clone())
        {
            negative.remove(&oldest);
        }
        negative.insert(key.to_string(), Instant::now());
    }

    async fn other_bucket(&self, req: &Prepared, disk: Option<&Disk>) -> Option<Cover> {
        let pick = |buckets: &[u32]| buckets.iter().copied().filter(|b| *b >= req.bucket).min().or_else(|| buckets.iter().copied().max());
        match disk {
            Some(disk) => {
                let canonical = req.plan.canonical.clone();
                let entries = disk.db.call(move |c| index::for_source(c, &canonical)).await.ok()?;
                let bucket = pick(&entries.iter().map(|e| e.bucket).collect::<Vec<_>>())?;
                read(disk, entries.iter().find(|e| e.bucket == bucket)?).await
            }
            None => {
                let mut memory = self.inner.memory.lock().unwrap();
                let buckets: Vec<u32> = source::BUCKETS.into_iter().filter(|b| memory.entries.contains_key(&cache_key(&req.plan.canonical, *b))).collect();
                memory.get(&cache_key(&req.plan.canonical, pick(&buckets)?))
            }
        }
    }

    pub async fn clear(&self, disk: Option<&Disk>) -> Result<(), CoverError> {
        *self.inner.memory.lock().unwrap() = Memory::default();
        self.inner.negative.lock().unwrap().clear();
        let Some(disk) = disk else { return Ok(()) };
        let entries = disk.db.call(index::by_last_served).await.map_err(|e| CoverError::Upstream(e.to_string()))?;
        for entry in entries {
            forget(disk, &entry.key).await;
        }
        Ok(())
    }
}

async fn read(disk: &Disk, entry: &Entry) -> Option<Cover> {
    let size = disk.files.size(&entry.key).await.ok().flatten().filter(|s| *s > 0);
    let bytes = match size {
        Some(size) => disk.files.read_range(&entry.key, 0, size - 1).await.ok(),
        None => None,
    };
    let Some(bytes) = bytes else {
        forget(disk, &entry.key).await;
        return None;
    };
    let key = entry.key.clone();
    let _ = disk.db.call(move |c| index::touch(c, &key, now_ms())).await;
    Some(Cover { bytes, content_type: entry.content_type.clone(), etag: etag(&entry.key) })
}

async fn forget(disk: &Disk, key: &str) {
    let _ = disk.files.delete(key).await;
    let key = key.to_string();
    let _ = disk.db.call(move |c| index::delete(c, &key)).await;
}

async fn store(disk: &Disk, req: &Prepared, cover: &Cover) -> Result<(), CoverError> {
    let failed = |e: nuvo_cache::CacheError| CoverError::Upstream(e.to_string());
    let mut writer = disk.files.begin(&req.key).await.map_err(failed)?;
    if let Err(err) = writer.write(&cover.bytes).await {
        writer.abort().await;
        return Err(failed(err));
    }
    writer.finish().await.map_err(failed)?;
    let entry = Entry { key: req.key.clone(), source: req.plan.canonical.clone(), bucket: req.bucket, content_type: cover.content_type.clone(), size_bytes: cover.bytes.len() as i64 };
    disk.db.call(move |c| index::upsert(c, &entry, now_ms())).await.map_err(|e| CoverError::Upstream(e.to_string()))?;
    evict(disk).await
}

/// Over the limit, the least recently served covers go until the total is under 90 % of it.
pub async fn evict(disk: &Disk) -> Result<(), CoverError> {
    let (limit, (mut total, _), entries) = disk
        .db
        .call(|c| Ok((index::stored_limit(c)?, index::totals(c)?, index::by_last_served(c)?)))
        .await
        .map_err(|e| CoverError::Upstream(e.to_string()))?;
    if limit == 0 || total <= limit {
        return Ok(());
    }
    let target = limit / 10 * 9;
    for entry in entries {
        if total <= target {
            break;
        }
        forget(disk, &entry.key).await;
        total -= entry.size_bytes;
    }
    Ok(())
}
