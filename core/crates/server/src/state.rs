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
use nuvo_fetch::bridge::Bridge;
use nuvo_fetch::{FetchError, TIKTOK_URL, TikTok};
use nuvo_lastfm::Lastfm;
use nuvo_lyrics::{Amll, Lrclib};
use nuvo_net::Net;
use nuvo_recognize::{Pace, Shazam};
use nuvo_soundcloud::{Limits, SoundCloud};
use nuvo_store::settings::Secrets;
use nuvo_store::{Db, StoreError, cache_index, convert_database, is_plain_database, now_ms, open_library, settings};
use reqwest::Url;
use serde_json::json;
use tokio::sync::{Mutex, Notify};

use crate::error::ApiError;
use crate::links::LinkCache;
use crate::routes::recognize::FileGrants;
use crate::{netcheck, precache};
use crate::paths::{Paths, ensure_private_dir};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edition {
    /// Library and caches stay as they are on disk; only service tokens are sealed, by the system keyring.
    Plain,
    Encrypted,
}

pub struct Config {
    pub paths: Paths,
    pub edition: Edition,
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
    /// Always known in the encrypted edition; in the plain one only while files sealed by an earlier edition remain.
    pub master: Option<MasterKey>,
    pub db: Db,
    pub cache: AudioCache,
    pub cover_files: AudioCache,
    pub secrets: Secrets,
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
    bridge: std::sync::Mutex<Option<Bridge>>,
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
    pub word_timing: crate::word_timing::Jobs,
    pub made_lyrics: crate::word_timing::Jobs,
    pub shutdown: Notify,
    pub edition: Edition,
    keystore: Arc<dyn KeyStore>,
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

fn load_or_create(keystore: &dyn KeyStore) -> Result<MasterKey, KeyStoreError> {
    if let Some(master) = keystore.load()? {
        return Ok(master);
    }
    let master: MasterKey = random_bytes();
    keystore.save(&master)?;
    Ok(master)
}

fn holds_sealed_files(paths: &Paths) -> bool {
    (paths.db.exists() && !is_plain_database(&paths.db))
        || AudioCache::plain(paths.audio.clone()).other_format_present()
        || AudioCache::plain(covers_dir(paths)).other_format_present()
}

// A library from the other edition is converted here, so either edition opens what the other left
fn open(paths: &Paths, edition: Edition, master: Option<MasterKey>, keystore: &Arc<dyn KeyStore>) -> Result<Unlocked, StoreError> {
    let (audio, covers) = (paths.audio.clone(), covers_dir(paths));
    let (wanted, cache, cover_files) = match (edition, master) {
        (Edition::Encrypted, Some(master)) => {
            let files = |dir: PathBuf| AudioCache::new(dir.clone(), &master).with_fallback(AudioCache::plain(dir));
            (Some(master), files(audio), files(covers))
        }
        (Edition::Encrypted, None) => return Err(StoreError::WrongKey),
        (Edition::Plain, master) => {
            let files = |dir: PathBuf| match master {
                Some(master) => AudioCache::plain(dir.clone()).with_fallback(AudioCache::new(dir, &master)),
                None => AudioCache::plain(dir),
            };
            (None, files(audio), files(covers))
        }
    };
    let sealed_db = paths.db.exists() && !is_plain_database(&paths.db);
    let mut db_master = if sealed_db { master } else { None };
    if paths.db.exists() && sealed_db != wanted.is_some() && (!sealed_db || master.is_some()) {
        match convert_database(&paths.db, db_master.as_ref(), wanted.as_ref(), &paths.backups) {
            Ok(()) => db_master = wanted,
            Err(StoreError::WrongKey) => return Err(StoreError::WrongKey),
            // a full disk, say: the library stays as it is for this run and converts on the next start
            Err(err) => tracing::warn!(%err, "library.db could not be converted, opening it as it is"),
        }
    }
    let secrets = if db_master.is_some() {
        Secrets::Clear
    } else {
        let keystore = keystore.clone();
        Secrets::sealed(move || match master {
            Some(master) => Ok(master),
            None => load_or_create(keystore.as_ref()).map_err(|err| StoreError::Io(std::io::Error::other(err.to_string()))),
        })
    };
    let conn = open_library(&paths.db, db_master.as_ref(), &paths.backups)?;
    match (&secrets, master) {
        (Secrets::Clear, Some(master)) => settings::reseal(&conn, &Secrets::sealed(move || Ok(master)), &secrets)?,
        _ => settings::reseal(&conn, &Secrets::Clear, &secrets)?,
    }
    Ok(Unlocked { master, db: Db::new(conn), cache, cover_files, secrets, history: Arc::default() })
}

// In the background after the stray-file sweep; until then the files of the other format are read as they are
async fn convert_caches(data: &Unlocked) {
    for files in [&data.cache, &data.cover_files] {
        match files.convert().await {
            Ok(0) => {}
            Ok(moved) => tracing::info!(moved, dir = %files.dir().display(), "converted cache files from the other edition"),
            Err(err) => tracing::warn!(%err, "cache files from the other edition stay as they are until the next start"),
        }
    }
}

impl AppState {
    pub fn downgrade(&self) -> Weak<Inner> {
        Arc::downgrade(&self.0)
    }

    pub fn upgrade(weak: &Weak<Inner>) -> Option<Self> {
        weak.upgrade().map(Self)
    }

    pub fn new(config: Config, keystore: Box<dyn KeyStore>) -> Self {
        let keystore: Arc<dyn KeyStore> = Arc::from(keystore);
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
            bridge: std::sync::Mutex::new(None),
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
            word_timing: Default::default(),
            made_lyrics: Default::default(),
            shutdown: Notify::new(),
            paths: config.paths,
            edition: config.edition,
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
            tokio::spawn(async move { convert_caches(&data).await });
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
        if self.edition == Edition::Plain {
            let master = if holds_sealed_files(paths) {
                self.keystore.load().unwrap_or_else(|err| {
                    tracing::warn!(%err, "secret service unavailable, files from the encrypted edition stay as they are");
                    None
                })
            } else {
                None
            };
            let unlocked = match open(paths, self.edition, master, &self.keystore) {
                Ok(unlocked) => Some(unlocked),
                Err(StoreError::WrongKey) => {
                    tracing::warn!("library.db is encrypted and its key is not at hand, starting locked");
                    None
                }
                Err(err) => return Err(err.into()),
            };
            *self.unlocked.write().expect("state lock") = unlocked;
            return Ok(());
        }
        let unlocked = match self.keystore.load() {
            Ok(Some(master)) => match open(paths, self.edition, Some(master), &self.keystore) {
                Ok(unlocked) => Some(unlocked),
                Err(StoreError::WrongKey) => {
                    tracing::warn!("keyring key does not open library.db, starting locked");
                    None
                }
                Err(err) => return Err(err.into()),
            },
            Ok(None) if paths.db.exists() && !is_plain_database(&paths.db) => None,
            Ok(None) => {
                let master: MasterKey = random_bytes();
                self.keystore.save(&master)?;
                Some(open(paths, self.edition, Some(master), &self.keystore)?)
            }
            Err(err) if paths.db.exists() && !is_plain_database(&paths.db) => {
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

    /// Starts a loopback bridge for a SOCKS proxy and answers its URL; Electron points Chromium at it when the proxy wants a login.
    pub fn set_proxy(&self, proxy: Option<Url>) -> Option<String> {
        let socks = proxy.as_ref().filter(|url| matches!(url.scheme(), "socks5" | "socks5h"));
        let bridge = socks.and_then(|url| Bridge::start(url.clone()).inspect_err(|err| tracing::warn!(%err, "the proxy bridge did not start")).ok());
        let url = bridge.as_ref().map(|bridge| bridge.url().to_string());
        *self.bridge.lock().expect("bridge lock") = bridge;
        *self.proxy.write().expect("proxy lock") = proxy;
        url
    }

    /// A plain HTTP proxy for ffmpeg: the proxy itself, or the bridge in front of a SOCKS one.
    pub fn ffmpeg_proxy(&self) -> Result<Option<String>, FetchError> {
        let bridge = self.bridge.lock().expect("bridge lock").as_ref().map(|bridge| bridge.url().to_string());
        nuvo_fetch::proxy::ffmpeg_proxy(self.proxy().as_ref(), bridge.as_deref())
    }

    /// The proxy hook only while a proxy is set, for callers that check addresses themselves when direct.
    pub fn active_proxy_hook(&self) -> Option<reqwest::Proxy> {
        self.proxy().map(|_| self.proxy_hook())
    }

    pub fn proxy_hook(&self) -> reqwest::Proxy {
        proxy_hook(&self.proxy)
    }

    pub fn key_protection(&self) -> &'static str {
        if self.edition == Edition::Plain {
            return "none";
        }
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
        let master = self.data()?.master.ok_or_else(|| ApiError::Conflict("this edition keeps no key to protect".into()))?;
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
        let (paths, edition, keystore) = (self.paths.clone(), self.edition, self.keystore.clone());
        let unlocked = tokio::task::spawn_blocking(move || open(&paths, edition, Some(master), &keystore))
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
        let converting = unlocked.clone();
        tokio::spawn(async move { convert_caches(&converting).await });
        *self.unlocked.write().expect("state lock") = Some(unlocked);
        crate::local::poke(self, crate::local::Msg::All);
        crate::downloads::poke(self);
        Ok(())
    }
}
