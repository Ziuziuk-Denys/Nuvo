mod common;

use axum::http::StatusCode;
use nuvo_crypto::{KeyStore, KeyStoreError, MasterKey, MemoryKeyStore, phrase_from_key};
use nuvo_server::{AppState, Edition};
use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_contracts::CreatePlaylist;
use nuvo_store::{library, lyrics_cache, opens_with, playlists, settings};
use serde_json::json;
use tempfile::TempDir;

const KEY: MasterKey = [9u8; 32];

struct NoKeyring;

impl KeyStore for NoKeyring {
    fn load(&self) -> Result<Option<MasterKey>, KeyStoreError> {
        panic!("the plain edition asked the keyring for a key");
    }

    fn save(&self, _key: &MasterKey) -> Result<(), KeyStoreError> {
        panic!("the plain edition stored a key");
    }
}

fn close(core: common::TestCore) -> TempDir {
    let common::TestCore { dir, state, app } = core;
    drop((state, app));
    dir
}

struct Shared(std::sync::Arc<MemoryKeyStore>);

impl KeyStore for Shared {
    fn load(&self) -> Result<Option<MasterKey>, KeyStoreError> {
        self.0.load()
    }

    fn save(&self, key: &MasterKey) -> Result<(), KeyStoreError> {
        self.0.save(key)
    }
}

async fn boot(dir: TempDir, edition: Edition, keystore: impl KeyStore + 'static) -> common::TestCore {
    let core = common::boot_config(dir, keystore, |config| config.edition = edition);
    core.state.start().await.unwrap();
    if let Ok(data) = core.state.data() {
        converted(&data).await;
    }
    core
}

async fn converted(data: &nuvo_server::state::Unlocked) {
    for _ in 0..100 {
        if !data.cache.other_format_present() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("the cache files were not converted");
}

async fn fill(state: &AppState) {
    let data = state.data().unwrap();
    let secrets = data.secrets.clone();
    data.db
        .call(move |c| {
            library::like(c, "t1", Some(json!({"id": "t1", "title": "One", "artists": [{"id": "a", "name": "A"}], "durationMs": 1000})), 1)?;
            settings::set(c, settings::DISPLAY_NAME, &json!("Den"))?;
            settings::set_secret(c, &secrets, settings::LASTFM_SESSION_KEY, &json!("session-123"))
        })
        .await
        .unwrap();
    store_audio(state).await;
}

async fn store_audio(state: &AppState) {
    let data = state.data().unwrap();
    let mut writer = data.cache.begin("t1").await.unwrap();
    writer.write(b"audio bytes").await.unwrap();
    let path = writer.finish().await.unwrap().path.to_string_lossy().into_owned();
    let entry = CacheEntry { track_id: "t1".into(), path, size_bytes: 11, mime: "audio/webm".into(), codec: None };
    data.db.call(move |c| cache_index::upsert(c, &entry, 1)).await.unwrap();
}

async fn check(state: &AppState) {
    let data = state.data().unwrap();
    let secrets = data.secrets.clone();
    let (liked, name, session) = data
        .db
        .call(move |c| Ok((library::liked_ids(c)?, settings::get(c, settings::DISPLAY_NAME)?, settings::get_secret(c, &secrets, settings::LASTFM_SESSION_KEY)?)))
        .await
        .unwrap();
    assert_eq!(liked, vec!["t1".to_string()]);
    assert_eq!(name, Some(json!("Den")));
    assert_eq!(session, Some(json!("session-123")));
    assert_eq!(data.cache.read_range("t1", 0, 10).await.unwrap(), b"audio bytes");
}

fn files(dir: &std::path::Path, ext: &str) -> usize {
    std::fs::read_dir(dir).unwrap().filter(|e| e.as_ref().unwrap().path().extension().is_some_and(|x| x == ext)).count()
}

fn raw_session(state: &AppState) -> String {
    let conn = nuvo_store::open_library(&state.paths.db, None, &state.paths.backups).unwrap();
    settings::get(&conn, settings::LASTFM_SESSION_KEY).unwrap().unwrap().to_string()
}

#[tokio::test]
async fn a_new_plain_library_never_touches_the_keyring() {
    let core = boot(tempfile::tempdir().unwrap(), Edition::Plain, NoKeyring).await;
    let one = json!({"id": "t1", "title": "One", "artists": [{"id": "a", "name": "A"}], "durationMs": 1000});
    core.state.data().unwrap().db.call(move |c| library::like(c, "t1", Some(one), 1)).await.unwrap();
    store_audio(&core.state).await;

    assert!(opens_with(&core.state.paths.db, None));
    assert_eq!(files(&core.state.paths.audio, "bin"), 1);
    assert_eq!(common::call(&core.app, "GET", "/v1/system/key-storage", None).await.1["protection"], "none");
    assert_eq!(common::call(&core.app, "GET", "/v1/recovery/phrase", None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "PUT", "/v1/system/key-passphrase", Some(json!({"passphrase": "long enough phrase"}))).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn the_plain_edition_creates_a_key_only_when_a_token_is_stored() {
    let keystore = std::sync::Arc::new(MemoryKeyStore::default());
    let core = boot(tempfile::tempdir().unwrap(), Edition::Plain, Shared(keystore.clone())).await;
    assert_eq!(keystore.load().unwrap(), None);
    fill(&core.state).await;
    assert!(keystore.load().unwrap().is_some());
    check(&core.state).await;
    assert!(!raw_session(&core.state).contains("session-123"));
}

#[tokio::test]
async fn an_encrypted_library_opens_in_the_plain_edition_with_everything_in_it() {
    let first = boot(tempfile::tempdir().unwrap(), Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;
    fill(&first.state).await;
    let dir = close(first);

    let core = boot(dir, Edition::Plain, MemoryKeyStore::with_key(KEY)).await;

    check(&core.state).await;
    assert!(opens_with(&core.state.paths.db, None));
    assert_eq!((files(&core.state.paths.audio, "lac"), files(&core.state.paths.audio, "bin")), (0, 1));
    assert!(!raw_session(&core.state).contains("session-123"), "the token must stay sealed");
    let dir = close(core);

    let again = boot(dir, Edition::Plain, NoKeyring).await;
    assert_eq!(again.state.data().unwrap().db.call(library::liked_ids).await.unwrap(), vec!["t1".to_string()]);
}

#[tokio::test]
async fn a_plain_library_opens_in_the_encrypted_edition_with_everything_in_it() {
    let first = boot(tempfile::tempdir().unwrap(), Edition::Plain, MemoryKeyStore::with_key(KEY)).await;
    fill(&first.state).await;
    let dir = close(first);

    let core = boot(dir, Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;

    check(&core.state).await;
    assert!(!opens_with(&core.state.paths.db, None));
    assert_eq!((files(&core.state.paths.audio, "lac"), files(&core.state.paths.audio, "bin")), (1, 0));
    let data = core.state.data().unwrap();
    let inside = data.db.call(|c| settings::get(c, settings::LASTFM_SESSION_KEY)).await.unwrap();
    assert_eq!(inside, Some(json!("session-123")), "inside an encrypted library the token is kept as is");
}

#[tokio::test]
async fn a_plain_edition_without_the_key_starts_locked_and_the_phrase_converts_the_library() {
    let first = boot(tempfile::tempdir().unwrap(), Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;
    fill(&first.state).await;
    let dir = close(first);

    let core = boot(dir, Edition::Plain, MemoryKeyStore::unavailable()).await;
    assert!(core.state.is_locked());
    let restore = json!({"phrase": phrase_from_key(&KEY)});
    assert_eq!(common::call(&core.app, "POST", "/v1/recovery/restore", Some(restore)).await.0, StatusCode::NO_CONTENT);
    converted(&core.state.data().unwrap()).await;

    check(&core.state).await;
    assert!(opens_with(&core.state.paths.db, None));
    assert_eq!(files(&core.state.paths.audio, "lac"), 0);
}

#[tokio::test]
async fn a_conversion_cut_short_finishes_on_the_next_start() {
    let first = boot(tempfile::tempdir().unwrap(), Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;
    fill(&first.state).await;
    let data = first.state.data().unwrap();
    for id in ["t2", "t3"] {
        let mut writer = data.cache.begin(id).await.unwrap();
        writer.write(id.as_bytes()).await.unwrap();
        let path = writer.finish().await.unwrap().path.to_string_lossy().into_owned();
        let entry = CacheEntry { track_id: id.into(), path, size_bytes: 2, mime: "audio/webm".into(), codec: None };
        data.db.call(move |c| cache_index::upsert(c, &entry, 1)).await.unwrap();
    }
    let (paths, t2) = (first.state.paths.clone(), data.cache.path_for("t2"));
    drop(data);
    let dir = close(first);

    std::fs::write(paths.db.with_extension("next"), b"half an export").unwrap();
    let plain_t2 = t2.with_extension("bin");
    std::fs::write(&plain_t2, b"t2").unwrap();
    std::fs::write(t2.with_extension("bin.00aa.part"), b"t").unwrap();

    let core = boot(dir, Edition::Plain, MemoryKeyStore::with_key(KEY)).await;
    check(&core.state).await;
    let data = core.state.data().unwrap();
    assert_eq!(data.cache.read_range("t2", 0, 1).await.unwrap(), b"t2");
    assert_eq!(data.cache.read_range("t3", 0, 1).await.unwrap(), b"t3");
    assert!(opens_with(&paths.db, None));
    assert!(!paths.db.with_extension("next").exists());
    let names: Vec<String> = std::fs::read_dir(&paths.audio).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(names.iter().all(|n| n.ends_with(".bin")), "{names:?}");
}

#[tokio::test]
async fn a_library_that_cannot_be_rewritten_opens_as_it_is_and_converts_later() {
    let first = boot(tempfile::tempdir().unwrap(), Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;
    fill(&first.state).await;
    let paths = first.state.paths.clone();
    let dir = close(first);
    let blocker = paths.db.with_extension("next");
    std::fs::create_dir(&blocker).unwrap();

    let core = boot(dir, Edition::Plain, MemoryKeyStore::with_key(KEY)).await;
    check(&core.state).await;
    assert!(!opens_with(&paths.db, None), "untouched while it cannot be rewritten");
    let dir = close(core);

    std::fs::remove_dir(&blocker).unwrap();
    let core = boot(dir, Edition::Plain, MemoryKeyStore::with_key(KEY)).await;
    check(&core.state).await;
    assert!(opens_with(&paths.db, None));
    assert!(!raw_session(&core.state).contains("session-123"));
}

#[tokio::test]
async fn cached_audio_plays_before_its_conversion() {
    let first = boot(tempfile::tempdir().unwrap(), Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;
    fill(&first.state).await;
    let dir = close(first);
    let core = common::boot_config(dir, MemoryKeyStore::with_key(KEY), |config| config.edition = Edition::Plain);
    let data = core.state.data().unwrap();
    assert!(data.cache.other_format_present(), "nothing converts before start");
    assert_eq!(data.cache.read_range("t1", 0, 10).await.unwrap(), b"audio bytes");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "a benchmark: run in release with TMPDIR on a disk and NUVO_BENCH_MB of cached audio"]
async fn benchmark_an_encrypted_library_turning_plain() {
    let megabytes: usize = std::env::var("NUVO_BENCH_MB").ok().and_then(|v| v.parse().ok()).unwrap_or(1024);
    let first = boot(tempfile::tempdir().unwrap(), Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;
    let data = first.state.data().unwrap();
    data.db
        .call(|c| {
            let tracks: Vec<serde_json::Value> = (0..5000)
                .map(|i| json!({"id": format!("t{i}"), "title": format!("Song {i}"), "artists": [{"id": format!("a{}", i % 700), "name": format!("Artist {}", i % 700)}], "album": {"id": format!("al{}", i % 900), "title": format!("Album {}", i % 900)}, "durationMs": 200000}))
                .collect();
            library::like_many(c, &tracks, 1)?;
            for list in 0..20 {
                let created = playlists::create(c, &CreatePlaylist { title: format!("List {list}"), description: None, is_public: false }, 2)?;
                playlists::add_tracks(c, &created.id, tracks[list * 250..(list + 1) * 250].to_vec(), 3)?;
            }
            for i in 0..5000 {
                lyrics_cache::put(c, &format!("t{i}"), None, true, 4)?;
            }
            Ok(())
        })
        .await
        .unwrap();
    let chunk = vec![7u8; 1 << 20];
    for file in 0..megabytes / 8 {
        let id = format!("t{file}");
        let mut writer = data.cache.begin(&id).await.unwrap();
        for _ in 0..8 {
            writer.write(&chunk).await.unwrap();
        }
        let path = writer.finish().await.unwrap().path.to_string_lossy().into_owned();
        let entry = CacheEntry { track_id: id, path, size_bytes: 8 << 20, mime: "audio/webm".into(), codec: None };
        data.db.call(move |c| cache_index::upsert(c, &entry, 1)).await.unwrap();
    }
    let db_bytes = std::fs::metadata(&first.state.paths.db).unwrap().len();
    assert!(!opens_with(&first.state.paths.db, None), "the benchmark starts from an encrypted library");
    drop(data);
    let dir = close(first);

    let started = std::time::Instant::now();
    let core = common::boot_config(dir, MemoryKeyStore::with_key(KEY), |config| config.edition = Edition::Plain);
    let opened = started.elapsed();
    core.state.start().await.unwrap();
    let ready = started.elapsed();
    let data = core.state.data().unwrap();
    let played = std::time::Instant::now();
    assert_eq!(data.cache.read_range("t0", 0, (1 << 20) - 1).await.unwrap(), chunk);
    let first_read = played.elapsed();
    while data.cache.other_format_present() {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let all = started.elapsed();
    assert!(opens_with(&core.state.paths.db, None));
    assert_eq!(data.db.call(library::liked_ids).await.unwrap().len(), 5000);
    println!(
        "library.db {:.1} MB converted and opened in {opened:?}; ready in {ready:?}; first 1 MB read before conversion {first_read:?}; {megabytes} MB of audio converted in {:?} ({:.0} MB/s)",
        db_bytes as f64 / 1e6,
        all - ready,
        megabytes as f64 / (all - ready).as_secs_f64()
    );
}

#[tokio::test]
async fn an_encrypted_library_left_with_its_wal_converts_and_keeps_everything() {
    let dir = tempfile::tempdir().unwrap();
    let paths = nuvo_server::paths::Paths::under(dir.path());
    let conn = nuvo_store::open_library(&paths.db, Some(&KEY), &paths.backups).unwrap();
    let one = json!({"id": "t1", "title": "One", "artists": [{"id": "a", "name": "A"}], "durationMs": 1000});
    library::like(&conn, "t1", Some(one), 1).unwrap();
    std::mem::forget(conn);

    let core = boot(dir, Edition::Encrypted, MemoryKeyStore::with_key([1u8; 32])).await;
    assert!(core.state.is_locked(), "a wrong key never turns into an empty library");
    let dir = close(core);

    let core = boot(dir, Edition::Plain, MemoryKeyStore::with_key(KEY)).await;
    assert_eq!(core.state.data().unwrap().db.call(library::liked_ids).await.unwrap(), vec!["t1".to_string()]);
    assert!(opens_with(&paths.db, None));
}

#[tokio::test]
async fn a_new_library_starts_in_its_edition_format() {
    let encrypted = boot(tempfile::tempdir().unwrap(), Edition::Encrypted, MemoryKeyStore::with_key(KEY)).await;
    assert!(!opens_with(&encrypted.state.paths.db, None) && opens_with(&encrypted.state.paths.db, Some(&KEY)));
    let plain = boot(tempfile::tempdir().unwrap(), Edition::Plain, NoKeyring).await;
    assert!(opens_with(&plain.state.paths.db, None));
}
