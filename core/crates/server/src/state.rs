use std::ops::Deref;
use std::path::PathBuf;
use std::sync::{Arc, RwLock, Weak};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use nuvo_cache::AudioCache;
use nuvo_covers::{Covers, Disk};
use nuvo_contracts::{Deps, NetCheck, ToolDownload};
use nuvo_crypto::{KeyStore, KeyStoreError, MasterKey, Protection, random_bytes};
use nuvo_fetch::tools::ToolEnv;
use nuvo_fetch::{TIKTOK_URL, TikTok};
use nuvo_lastfm::Lastfm;
use nuvo_lyrics::{Amll, Lrclib};
use nuvo_net::Net;
use nuvo_recognize::{Pace, Shazam};
use nuvo_soundcloud::{Limits, SoundCloud};
use nuvo_store::{Db, StoreError, cache_index, now_ms, settings};
use reqwest::Url;
use serde_json::json;
use tokio::sync::{Mutex, Notify};

use crate::error::ApiError;
use crate::links::LinkCache;
use crate::routes::recognize::FileGrants;
use crate::{netcheck, precache};
use crate::paths::{Paths, ensure_private_dir};

pub struct Config {
    pub paths: Paths,
    pub token: String,
    pub lrclib_url: String,
    pub amll_url: String,
    pub shazam_url: String,
    pub lastfm_url: String,
    pub pace: Pace,
    pub exit_on_stdin_eof: bool,
    pub net_rewrite: Option<String>,
    pub env: ToolEnv,
    pub tools_url: Option<String>,
    #[doc(hidden)]
    pub test: TestHooks,
}

#[derive(Clone, Default)]
pub struct TestHooks {
    pub net: Option<netcheck::Setup>,
    pub fetch_hosts: Vec<String>,
    pub job_timeout: Option<std::time::Duration>,
    pub tiktok_url: Option<String>,
    pub local_debounce: Option<Duration>,
    pub system_clip: Option<std::path::PathBuf>,
    pub finish_failures: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

#[derive(Debug, thiserror::Error)]
pub enum BootError {
    #[error("no Secret Service to keep a new key in: {0}")]
    KeyStore(#[from] KeyStoreError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Clone)]
pub struct Unlocked {
    pub master: MasterKey,
    pub db: Db,
    pub cache: AudioCache,
    pub cover_files: AudioCache,
    pub history: Arc<std::sync::Mutex<nuvo_store::listening::History>>,
}

pub struct Inner {
    pub token: String,
    pub paths: Paths,
    pub lrclib: Lrclib,
    pub amll: Option<Amll>,
    pub shazam: Shazam,
    pub tiktok: TikTok,
    pub links: LinkCache,
    pub files: FileGrants,
    pub lastfm: Lastfm,
    pub net: Net,
    pub covers: Covers,
    soundcloud: SoundCloud,
    soundcloud_loaded: AtomicBool,
    pub http: reqwest::Client,
    proxy: Arc<RwLock<Option<Url>>>,
    /// Held while a scrobble batch is in flight, so two flushes never send the same plays.
    pub scrobble_lock: Mutex<()>,
    pub deps_lock: Mutex<()>,
    pub net_lock: Mutex<Option<std::time::Instant>>,
    pub exit_on_stdin_eof: bool,
    pub started: Instant,
    pub env: ToolEnv,
    pub deps: RwLock<Option<Deps>>,
    pub deps_checked_at: RwLock<i64>,
    pub net_setup: netcheck::Setup,
    pub last_network_check: RwLock<Option<NetCheck>>,
    pub tools_url: Option<String>,
    pub tool_download: RwLock<Option<ToolDownload>>,
    /// Wakes the tool downloader before its hourly round: a feature found a tool missing, or Settings asked.
    pub tool_wake: Notify,
    pub tool_requests: std::sync::Mutex<Vec<&'static str>>,
    pub test: TestHooks,
    pub fetches: precache::Jobs,
    pub local: crate::local::LocalService,
    pub downloads: crate::downloads::Worker,
    pub shutdown: Notify,
    keystore: Box<dyn KeyStore>,
    unlocked: RwLock<Option<Unlocked>>,
    starting: AtomicBool,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

impl Deref for AppState {
    type Target = Inner;

    fn deref(&self) -> &Inner {
        &self.0
    }
}

// shortcut: an idle keep-alive connection from before a proxy change is reused until it idles out (90 s)
fn proxy_hook(cell: &Arc<RwLock<Option<Url>>>) -> reqwest::Proxy {
    let cell = cell.clone();
    reqwest::Proxy::custom(move |_| cell.read().expect("proxy lock").clone())
}

pub fn covers_dir(paths: &Paths) -> PathBuf {
    paths.audio.with_file_name("covers")
}

fn open(paths: &Paths, master: MasterKey) -> Result<Unlocked, StoreError> {
    Ok(Unlocked {
        master,
        db: Db::open(&paths.db, &master, &paths.backups)?,
        cache: AudioCache::new(paths.audio.clone(), &master),
        cover_files: AudioCache::new(covers_dir(paths), &master),
        history: Arc::default(),
    })
}

impl AppState {
    pub fn downgrade(&self) -> Weak<Inner> {
        Arc::downgrade(&self.0)
    }

    pub fn upgrade(weak: &Weak<Inner>) -> Option<Self> {
        weak.upgrade().map(Self)
    }

    pub fn new(config: Config, keystore: Box<dyn KeyStore>) -> Self {
        let proxy = Arc::new(RwLock::new(None));
        let hook = proxy_hook(&proxy);
        let net = Net::with_proxy(config.net_rewrite, Some(hook.clone()));
        let state = Self(Arc::new(Inner {
            token: config.token,
            lrclib: Lrclib::with_proxy(config.lrclib_url, Some(hook.clone())),
            amll: Amll::with_proxy(&config.amll_url, Some(hook.clone())),
            shazam: Shazam::with_proxy(config.shazam_url, config.pace, Some(hook.clone())),
            tiktok: TikTok::with_proxy(config.test.tiktok_url.as_deref().unwrap_or(TIKTOK_URL), Some(hook.clone())),
            links: LinkCache::default(),
            files: FileGrants::default(),
            lastfm: Lastfm::with_proxy(config.lastfm_url, Some(hook.clone())),
            http: reqwest::Client::builder()
                .user_agent("nuvo-core/0.1 (personal music player)")
                .connect_timeout(Duration::from_secs(10))
                .proxy(hook)
                .build()
                .expect("static reqwest config is valid"),
            proxy,
            soundcloud: SoundCloud::new(net.clone(), Limits::SOUNDCLOUD),
            covers: Covers::new(net.clone(), nuvo_covers::Limits::COVERS),
            soundcloud_loaded: AtomicBool::new(false),
            net,
            scrobble_lock: Mutex::new(()),
            deps_lock: Mutex::new(()),
            net_lock: Mutex::new(None),
            exit_on_stdin_eof: config.exit_on_stdin_eof,
            started: Instant::now(),
            env: config.env,
            deps: RwLock::new(None),
            deps_checked_at: RwLock::new(0),
            net_setup: config.test.net.clone().unwrap_or_else(netcheck::Setup::production),
            last_network_check: RwLock::new(None),
            tools_url: config.tools_url,
            tool_download: RwLock::new(None),
            tool_wake: Notify::new(),
            tool_requests: Default::default(),
            test: config.test,
            fetches: precache::Jobs::default(),
            local: Default::default(),
            downloads: Default::default(),
            shutdown: Notify::new(),
            paths: config.paths,
            keystore,
            unlocked: RwLock::new(None),
            starting: AtomicBool::new(true),
        }));
        // Weak: the client lives inside the state it reports to.
        let weak: Weak<Inner> = Arc::downgrade(&state.0);
        state.soundcloud.on_client_id(move |id| {
            let Some(data) = weak.upgrade().and_then(|inner| AppState(inner).data().ok()) else { return };
            let value = json!({"id": id, "foundAt": now_ms()});
            tokio::spawn(async move {
                if let Err(err) = data.db.call(move |c| settings::set(c, settings::SOUNDCLOUD_CLIENT_ID, &value)).await {
                    tracing::warn!(%err, "could not store the SoundCloud client id");
                }
            });
        });
        state
    }

    pub fn boot(config: Config, keystore: Box<dyn KeyStore>) -> Result<Self, BootError> {
        let state = Self::new(config, keystore);
        state.open_library()?;
        state.starting.store(false, Ordering::SeqCst);
        Ok(state)
    }

    pub async fn start(&self) -> Result<(), BootError> {
        let state = self.clone();
        tokio::task::spawn_blocking(move || state.open_library()).await.map_err(std::io::Error::other)??;
        let unlocked = self.unlocked.read().expect("state lock").clone();
        if let Some(data) = unlocked {
            let partials = data.cache.remove_partials().await.map_err(std::io::Error::other)?;
            let indexed = data.db.call(|c| Ok(cache_index::all(c)?.into_iter().map(|e| e.track_id).collect::<Vec<_>>())).await?;
            let unindexed = data.cache.remove_unindexed(&indexed).await.map_err(std::io::Error::other)?;
            tracing::info!(partials, unindexed, "removed stray cache files");
            let covers = data.db.call(|c| Ok(nuvo_covers::index::by_last_served(c)?.into_iter().map(|e| e.key).collect::<Vec<_>>())).await?;
            let stray = data.cover_files.remove_partials().await.map_err(std::io::Error::other)? + data.cover_files.remove_unindexed(&covers).await.map_err(std::io::Error::other)?;
            tracing::info!(stray, "removed stray cover files");
            crate::downloads::clean_stale(&data).await;
        }
        self.starting.store(false, Ordering::SeqCst);
        crate::local::poke(self, crate::local::Msg::All);
        crate::downloads::poke(self);
        tracing::info!(locked = self.is_locked(), "nuvo-core ready");
        Ok(())
    }

    // An existing library.db is never replaced: without a usable key the daemon starts locked
    fn open_library(&self) -> Result<(), BootError> {
        let paths = &self.paths;
        if let Some(dir) = paths.db.parent() {
            ensure_private_dir(dir)?;
        }
        ensure_private_dir(&paths.audio)?;
        ensure_private_dir(&covers_dir(paths))?;
        let unlocked = match self.keystore.load() {
            Ok(Some(master)) => match open(paths, master) {
                Ok(unlocked) => Some(unlocked),
                Err(StoreError::WrongKey) => {
                    tracing::warn!("keyring key does not open library.db, starting locked");
                    None
                }
                Err(err) => return Err(err.into()),
            },
            Ok(None) if paths.db.exists() => None,
            Ok(None) => {
                let master: MasterKey = random_bytes();
                self.keystore.save(&master)?;
                Some(open(paths, master)?)
            }
            Err(err) if paths.db.exists() => {
                tracing::warn!(%err, "secret service unavailable, starting locked");
                None
            }
            Err(err) => return Err(err.into()),
        };
        *self.unlocked.write().expect("state lock") = unlocked;
        Ok(())
    }

    pub fn is_starting(&self) -> bool {
        self.starting.load(Ordering::SeqCst)
    }

    pub fn data(&self) -> Result<Unlocked, ApiError> {
        if self.is_starting() {
            return Err(ApiError::Starting);
        }
        self.unlocked.read().expect("state lock").clone().ok_or(ApiError::Locked)
    }

    pub fn cover_disk(&self) -> Option<Disk> {
        self.data().ok().map(|d| Disk { db: d.db, files: d.cover_files })
    }

    pub fn is_locked(&self) -> bool {
        self.unlocked.read().expect("state lock").is_none()
    }

    pub async fn soundcloud(&self) -> &SoundCloud {
        if !self.soundcloud_loaded.load(Ordering::SeqCst)
            && let Ok(data) = self.data()
        {
            let stored = data.db.call(|c| settings::get(c, settings::SOUNDCLOUD_CLIENT_ID)).await.ok().flatten();
            if let Some(id) = stored.as_ref().and_then(|v| v["id"].as_str())
                && self.soundcloud.client_id().is_none()
            {
                self.soundcloud.set_client_id(Some(id.to_string()));
            }
            self.soundcloud_loaded.store(true, Ordering::SeqCst);
        }
        &self.soundcloud
    }

    pub fn proxy(&self) -> Option<Url> {
        self.proxy.read().expect("proxy lock").clone()
    }

    pub fn proxy_url(&self) -> Option<String> {
        self.proxy().map(String::from)
    }

    pub fn set_proxy(&self, proxy: Option<Url>) {
        *self.proxy.write().expect("proxy lock") = proxy;
    }

    pub fn proxy_hook(&self) -> reqwest::Proxy {
        proxy_hook(&self.proxy)
    }

    pub fn key_protection(&self) -> &'static str {
        match self.keystore.protection() {
            Protection::Keyring => "keyring",
            Protection::File => "file",
            Protection::Passphrase => "passphrase",
        }
    }

    pub fn needs_passphrase(&self) -> bool {
        !self.is_starting() && self.is_locked() && self.keystore.protection() == Protection::Passphrase
    }

    /// The key derivation takes a fraction of a second, so it runs off the async threads.
    pub async fn unlock_with_passphrase(&self, passphrase: String) -> Result<(), ApiError> {
        let state = self.clone();
        let master = tokio::task::spawn_blocking(move || state.keystore.unlock_with_passphrase(&passphrase))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?
            .map_err(|err| match err {
                KeyStoreError::WrongPassphrase => ApiError::Invalid("wrong passphrase".into()),
                KeyStoreError::NoFile => ApiError::Conflict("the key is not sealed with a passphrase".into()),
                other => ApiError::Internal(other.to_string()),
            })?;
        self.unlock_with(master).await
    }

    pub async fn set_key_passphrase(&self, passphrase: Option<String>) -> Result<(), ApiError> {
        let master = self.data()?.master;
        let state = self.clone();
        tokio::task::spawn_blocking(move || state.keystore.set_passphrase(&master, passphrase.as_deref()))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?
            .map_err(|err| match err {
                KeyStoreError::NoFile => ApiError::Conflict("the key is in the system keyring; it needs no passphrase".into()),
                other => ApiError::Internal(other.to_string()),
            })
    }

    pub async fn unlock_with(&self, master: MasterKey) -> Result<(), ApiError> {
        let paths = self.paths.clone();
        let unlocked = tokio::task::spawn_blocking(move || open(&paths, master))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?
            .map_err(|err| match err {
                StoreError::WrongKey => ApiError::Invalid("this phrase does not open the library".into()),
                other => other.into(),
            })?;
        if let Err(err) = self.keystore.save(&master) {
            tracing::warn!(%err, "unlocked, but the key could not be saved; the phrase will be needed again");
        }
        unlocked.db.call(|c| settings::set(c, settings::RECOVERY_CONFIRMED, &json!(true))).await?;
        *self.unlocked.write().expect("state lock") = Some(unlocked);
        crate::local::poke(self, crate::local::Msg::All);
        crate::downloads::poke(self);
        Ok(())
    }
}
