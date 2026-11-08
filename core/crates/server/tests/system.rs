mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use std::sync::{Mutex, mpsc};

use nuvo_crypto::{KeyStore, MemoryKeyStore};
use nuvo_server::paths::Paths;
use nuvo_server::{AppState, Config, router};
use serde_json::json;

#[tokio::test]
async fn every_route_requires_the_token() {
    let core = common::core();
    for auth in [None, Some("Bearer wrong"), Some(common::TOKEN)] {
        let mut req = Request::get("/health");
        if let Some(value) = auth {
            req = req.header("authorization", value);
        }
        let (status, body, _) = common::send(&core.app, req.body(Body::empty()).unwrap()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "auth {auth:?}");
        let error: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(error["code"], "UNAUTHORIZED");
        assert!(error["reqId"].is_string());
    }
}

#[tokio::test]
async fn first_run_creates_a_key_and_an_unlocked_library() {
    let dir = tempfile::tempdir().unwrap();
    let store = std::sync::Arc::new(MemoryKeyStore::default());
    let core = common::boot(dir, SharedStore(store.clone()), "http://127.0.0.1:9");
    assert_eq!(common::call(&core.app, "GET", "/health", None).await, (StatusCode::OK, json!({"status": "ok", "locked": false})));
    assert!(store.load().unwrap().is_some());
    assert!(core.dir.path().join("data/library.db").exists());
}

#[tokio::test]
async fn existing_library_without_a_key_starts_locked_and_is_not_replaced() {
    let first = common::core();
    let db = first.dir.path().join("data/library.db");
    let before = std::fs::read(&db).unwrap();
    let locked = common::boot(first.dir, MemoryKeyStore::default(), "http://127.0.0.1:9");
    assert_eq!(common::call(&locked.app, "GET", "/health", None).await.1["locked"], true);
    assert_eq!(std::fs::read(&db).unwrap(), before);
}

#[tokio::test]
async fn unavailable_secret_service_locks_an_existing_library_and_fails_a_fresh_one() {
    let first = common::core();
    let locked = common::boot(first.dir, MemoryKeyStore::unavailable(), "http://127.0.0.1:9");
    assert!(locked.state.is_locked());

    let config = nuvo_server::Config {
        tools_url: None,
        paths: nuvo_server::paths::Paths::under(tempfile::tempdir().unwrap().path()),
        token: common::TOKEN.into(),
        lrclib_url: String::new(),
        amll_url: String::new(),
        shazam_url: String::new(),
        pace: common::FAST,
        lastfm_url: String::new(),
        exit_on_stdin_eof: false,
        net_rewrite: None,
        env: Default::default(),
        test: Default::default(),
    };
    assert!(nuvo_server::AppState::boot(config, Box::new(MemoryKeyStore::unavailable())).is_err());
}

#[tokio::test]
async fn a_key_that_does_not_match_starts_locked() {
    let first = common::core();
    let core = common::boot(first.dir, MemoryKeyStore::with_key([9u8; 32]), "http://127.0.0.1:9");
    assert!(core.state.is_locked());
}

#[tokio::test]
async fn shutdown_route_signals_the_server() {
    let core = common::core();
    let waiter = core.state.clone();
    let notified = tokio::spawn(async move { waiter.shutdown.notified().await });
    tokio::task::yield_now().await;
    assert_eq!(common::call(&core.app, "POST", "/v1/system/shutdown", None).await.0, StatusCode::NO_CONTENT);
    tokio::time::timeout(std::time::Duration::from_secs(1), notified).await.unwrap().unwrap();
}

/// Lets a test keep a handle on the store it gave to the daemon.
struct SharedStore(std::sync::Arc<MemoryKeyStore>);

impl KeyStore for SharedStore {
    fn load(&self) -> Result<Option<nuvo_crypto::MasterKey>, nuvo_crypto::KeyStoreError> {
        self.0.load()
    }
    fn save(&self, key: &nuvo_crypto::MasterKey) -> Result<(), nuvo_crypto::KeyStoreError> {
        self.0.save(key)
    }
}

/// A keyring that blocks in `load` until the test lets it go, like an open unlock prompt.
struct PromptStore {
    answer: Mutex<mpsc::Receiver<()>>,
    inner: MemoryKeyStore,
}

impl KeyStore for PromptStore {
    fn load(&self) -> Result<Option<nuvo_crypto::MasterKey>, nuvo_crypto::KeyStoreError> {
        let _ = self.answer.lock().unwrap().recv();
        self.inner.load()
    }
    fn save(&self, key: &nuvo_crypto::MasterKey) -> Result<(), nuvo_crypto::KeyStoreError> {
        self.inner.save(key)
    }
}

#[tokio::test]
async fn health_answers_starting_and_data_routes_wait_while_the_keyring_prompt_is_open() {
    let dir = tempfile::tempdir().unwrap();
    let (answer, prompt) = mpsc::channel();
    let config = Config { tools_url: None, paths: Paths::under(dir.path()), token: common::TOKEN.into(), lrclib_url: String::new(), amll_url: String::new(), shazam_url: String::new(), lastfm_url: String::new(), pace: common::FAST, exit_on_stdin_eof: false, net_rewrite: None, env: Default::default(), test: Default::default() };
    let state = AppState::new(config, Box::new(PromptStore { answer: Mutex::new(prompt), inner: MemoryKeyStore::default() }));
    let app = router(state.clone());
    let booting = tokio::spawn({
        let state = state.clone();
        async move { state.start().await }
    });

    assert_eq!(common::call(&app, "GET", "/health", None).await, (StatusCode::OK, json!({"status": "starting", "locked": false})));
    let (status, body) = common::call(&app, "GET", "/v1/recovery/phrase", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::SERVICE_UNAVAILABLE, Some("CORE_STARTING")));
    let restore = json!({"phrase": "abandon abandon abandon"});
    assert_eq!(common::call(&app, "POST", "/v1/recovery/restore", Some(restore)).await.0, StatusCode::SERVICE_UNAVAILABLE);

    answer.send(()).unwrap();
    booting.await.unwrap().unwrap();
    assert_eq!(common::call(&app, "GET", "/health", None).await, (StatusCode::OK, json!({"status": "ok", "locked": false})));
    assert_eq!(common::call(&app, "GET", "/v1/recovery/phrase", None).await.0, StatusCode::OK);
}
