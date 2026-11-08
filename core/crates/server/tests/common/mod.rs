#![allow(dead_code)]

pub mod proxy;

use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use nuvo_crypto::{KeyStore, MemoryKeyStore};
use nuvo_recognize::Pace;
use nuvo_server::paths::Paths;
use nuvo_server::{AppState, Config, router};
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;

pub const TOKEN: &str = "test-token-0123456789abcdef0123456789";

pub struct TestCore {
    pub dir: TempDir,
    pub state: AppState,
    pub app: Router,
}

/// No spacing and millisecond back-off, so recognize tests do not wait for Shazam's real pace.
pub const FAST: Pace = Pace { spacing: Duration::ZERO, backoff: [Duration::from_millis(5); 3] };

pub fn boot(dir: TempDir, keystore: impl KeyStore + 'static, lrclib_url: &str) -> TestCore {
    boot_urls(dir, keystore, lrclib_url, "http://127.0.0.1:9", "http://127.0.0.1:9/2.0/")
}

/// Like `boot`, with Shazam pointed at a local mock.
pub fn boot_with(dir: TempDir, keystore: impl KeyStore + 'static, lrclib_url: &str, shazam_url: &str) -> TestCore {
    boot_urls(dir, keystore, lrclib_url, shazam_url, "http://127.0.0.1:9/2.0/")
}

/// Like `boot`, with Last.fm pointed at a local mock.
pub fn boot_lastfm(dir: TempDir, keystore: impl KeyStore + 'static, lrclib_url: &str, lastfm_url: &str) -> TestCore {
    boot_urls(dir, keystore, lrclib_url, "http://127.0.0.1:9", lastfm_url)
}

/// Like `boot`, with catalog and artwork requests sent to a `nuvo_net::fixture::Fixture` at `fixture_base`.
pub fn boot_net(dir: TempDir, keystore: impl KeyStore + 'static, fixture_base: &str) -> TestCore {
    boot_config(dir, keystore, |config| config.net_rewrite = Some(fixture_base.to_string()))
}

fn boot_urls(dir: TempDir, keystore: impl KeyStore + 'static, lrclib_url: &str, shazam_url: &str, lastfm_url: &str) -> TestCore {
    boot_config(dir, keystore, |config| {
        config.lrclib_url = lrclib_url.into();
        config.shazam_url = shazam_url.into();
        config.lastfm_url = lastfm_url.into();
    })
}

/// Fresh profile whose config `edit` adjusts first. Every URL starts at the closed port 9.
pub fn boot_config(dir: TempDir, keystore: impl KeyStore + 'static, edit: impl FnOnce(&mut Config)) -> TestCore {
    let mut config = Config {
        paths: Paths::under(dir.path()),
        token: TOKEN.into(),
        tools_url: None,
        lrclib_url: "http://127.0.0.1:9".into(),
        amll_url: String::new(),
        shazam_url: "http://127.0.0.1:9".into(),
        pace: FAST,
        lastfm_url: "http://127.0.0.1:9/2.0/".into(),
        exit_on_stdin_eof: false,
        net_rewrite: None,
        env: Default::default(),
        test: Default::default(),
    };
    edit(&mut config);
    let state = AppState::boot(config, Box::new(keystore)).unwrap();
    TestCore { app: router(state.clone()), state, dir }
}

/// Fresh profile with an in-memory keystore; LRCLIB points at a closed port.
pub fn core() -> TestCore {
    boot(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), "http://127.0.0.1:9")
}

pub fn request(method: &str, path: &str, body: Option<Value>) -> Request<Body> {
    let builder = Request::builder().method(method).uri(path).header("authorization", format!("Bearer {TOKEN}"));
    match body {
        Some(json) => builder.header("content-type", "application/json").body(Body::from(json.to_string())).unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

pub async fn send(app: &Router, req: Request<Body>) -> (StatusCode, Vec<u8>, axum::http::HeaderMap) {
    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, bytes, headers)
}

/// JSON call; an empty body comes back as `Value::Null`.
pub async fn call(app: &Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let (status, bytes, _) = send(app, request(method, path, body)).await;
    let json = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() };
    (status, json)
}

/// A core that has not made its start decision yet (the keyring prompt is still open).
pub fn starting() -> (TempDir, Router) {
    let dir = tempfile::tempdir().unwrap();
    let config = Config {
        paths: Paths::under(dir.path()),
        token: TOKEN.into(),
        tools_url: None,
        lrclib_url: "http://127.0.0.1:9".into(),
        amll_url: String::new(),
        shazam_url: "http://127.0.0.1:9".into(),
        pace: FAST,
        lastfm_url: "http://127.0.0.1:9/2.0/".into(),
        exit_on_stdin_eof: false,
        net_rewrite: None,
        env: Default::default(),
        test: Default::default(),
    };
    let state = AppState::new(config, Box::new(MemoryKeyStore::default()));
    assert!(state.is_starting());
    (dir, router(state))
}

/// A silent mono 16-bit WAV at 8 kHz, `seconds` long: real audio for local-file tests.
pub fn wav_bytes(seconds: u32) -> Vec<u8> {
    let rate = 8000u32;
    let data_len = rate * seconds * 2;
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data_len).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    for v in [1u16, 1] { b.extend_from_slice(&v.to_le_bytes()); }
    for v in [rate, rate * 2] { b.extend_from_slice(&v.to_le_bytes()); }
    for v in [2u16, 16] { b.extend_from_slice(&v.to_le_bytes()); }
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_len.to_le_bytes());
    b.resize(44 + data_len as usize, 0);
    b
}

pub fn write_wav(path: &std::path::Path, seconds: u32) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, wav_bytes(seconds)).unwrap();
}

/// A core whose folder watcher settles after 30 ms instead of 2 s.
pub fn local_core() -> TestCore {
    boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |c| c.test.local_debounce = Some(Duration::from_millis(30)))
}

/// Adds a music folder the way Electron main does and returns its JSON.
pub async fn add_folder(core: &TestCore, path: &std::path::Path) -> (StatusCode, Value) {
    call(&core.app, "POST", "/v1/fs/local/roots", Some(serde_json::json!({"path": path.to_str().unwrap()}))).await
}

/// Polls the local track list until `done` holds (5 s at most).
pub async fn wait_tracks(core: &TestCore, done: impl Fn(&Value) -> bool) -> Value {
    for _ in 0..250 {
        let (_, page) = call(&core.app, "GET", "/v1/local/tracks?limit=500", None).await;
        let (_, status) = call(&core.app, "GET", "/v1/local/status", None).await;
        if status["scanning"] == false && done(&page) {
            return page;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("local tracks never matched");
}
