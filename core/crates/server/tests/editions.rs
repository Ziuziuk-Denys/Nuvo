mod common;

use axum::http::StatusCode;
use nuvo_crypto::{KeyStore, KeyStoreError, MasterKey, MemoryKeyStore, phrase_from_key};
use nuvo_server::{AppState, Edition};
use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_store::{is_plain_database, library, settings};
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

    assert!(is_plain_database(&core.state.paths.db));
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
    assert!(is_plain_database(&core.state.paths.db));
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
    assert!(!is_plain_database(&core.state.paths.db));
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
    assert!(is_plain_database(&core.state.paths.db));
    assert_eq!(files(&core.state.paths.audio, "lac"), 0);
}
