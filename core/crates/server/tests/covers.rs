mod common;

use std::io::Cursor;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use nuvo_crypto::MemoryKeyStore;
use nuvo_net::fixture::{Fixture, Reply};
use serde_json::json;

const SRC: &str = "https%3A%2F%2Fi1.sndcdn.com%2Fartworks-1-large.jpg";
const CDN_512: &str = "https://i1.sndcdn.com/artworks-1-t500x500.jpg";

fn jpeg(side: u32) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(RgbImage::from_pixel(side, side, Rgb([90, 30, 200]))).write_to(&mut out, ImageFormat::Jpeg).unwrap();
    out.into_inner()
}

async fn fixture() -> Fixture {
    let fx = Fixture::start().await;
    fx.on(CDN_512, Reply::bytes("image/jpeg", jpeg(500)));
    fx
}

fn core(fx: &Fixture) -> common::TestCore {
    common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base)
}

fn get(path: &str, etag: Option<&str>) -> Request<Body> {
    let mut req = Request::get(path).header("authorization", format!("Bearer {}", common::TOKEN));
    if let Some(etag) = etag {
        req = req.header("if-none-match", etag);
    }
    req.body(Body::empty()).unwrap()
}

fn cover_files(core: &common::TestCore) -> usize {
    std::fs::read_dir(core.dir.path().join("cache/covers")).map_or(0, |d| d.count())
}

/// The response headers.
#[tokio::test]
async fn covers_are_served_with_cache_headers_and_revalidate() {
    let fx = fixture().await;
    let core = core(&fx);
    let path = format!("/v1/covers?src={SRC}&size=300");
    let (status, bytes, headers) = common::send(&core.app, get(&path, None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, jpeg(500));
    assert_eq!(headers["content-type"], "image/jpeg");
    assert_eq!(headers["content-length"], bytes.len().to_string().as_str());
    assert_eq!(headers["cache-control"], "private, max-age=31536000, immutable");
    let etag = headers["etag"].to_str().unwrap().to_string();
    let (status, body, _) = common::send(&core.app, get(&path, Some(&etag))).await;
    assert_eq!((status, body.len()), (StatusCode::NOT_MODIFIED, 0));
    assert_eq!(fx.total(), 1);
    assert_eq!(cover_files(&core), 1, "stored in the encrypted cache");
    let stored = std::fs::read_dir(core.dir.path().join("cache/covers")).unwrap().next().unwrap().unwrap().path();
    assert!(!std::fs::read(stored).unwrap().windows(4).any(|w| w == b"JFIF"), "cover files are encrypted");
}

/// Refused sources at the route.
#[tokio::test]
async fn bad_requests_use_the_shared_error_shape() {
    let fx = fixture().await;
    let core = core(&fx);
    for path in [format!("/v1/covers?src={SRC}&size=-1"), format!("/v1/covers?src={SRC}&size=abc"), "/v1/covers".to_string(), "/v1/covers?src=http%3A%2F%2Fi1.sndcdn.com%2Fa-large.jpg".to_string()] {
        let (status, body) = common::call(&core.app, "GET", &path, None).await;
        assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{path}");
    }
    let (status, body) = common::call(&core.app, "GET", "/v1/covers?src=https%3A%2F%2Fevil.example%2Fa.jpg", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::FORBIDDEN, Some("FORBIDDEN_HOST")));
    assert_eq!(fx.total(), 0);
}

#[tokio::test]
async fn missing_and_broken_covers_map_to_404_and_502() {
    let fx = fixture().await;
    fx.on("https://i.ytimg.com/vi/x/sddefault.jpg", Reply::bytes("text/html", "<html>"));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/covers?src=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fgone%2Fhqdefault.jpg", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::NOT_FOUND, Some("NOT_FOUND")));
    let (status, body) = common::call(&core.app, "GET", "/v1/covers?src=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fx%2Fhqdefault.jpg&size=512", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_GATEWAY, Some("UPSTREAM")));
}

#[tokio::test]
async fn clearing_covers_keeps_audio_and_the_other_way_round() {
    let fx = fixture().await;
    let core = core(&fx);
    let upload = Request::put("/v1/cache/audio/t1")
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", "audio/webm")
        .body(Body::from(vec![7u8; 1000]))
        .unwrap();
    assert_eq!(common::send(&core.app, upload).await.0, StatusCode::NO_CONTENT);
    let path = format!("/v1/covers?src={SRC}");
    assert_eq!(common::send(&core.app, get(&path, None)).await.0, StatusCode::OK);
    assert_eq!(common::call(&core.app, "DELETE", "/v1/cache/covers", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(cover_files(&core), 0);
    assert_eq!(common::send(&core.app, get("/v1/cache/audio/t1", None)).await.1, vec![7u8; 1000]);
    assert_eq!(common::send(&core.app, get(&path, None)).await.0, StatusCode::OK);
    assert_eq!(fx.total(), 2, "the cover was fetched again");
    assert_eq!(common::call(&core.app, "DELETE", "/v1/cache/audio", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(cover_files(&core), 1, "clearing audio leaves covers");
}

/// Exact totals and the covers limit setting.
#[tokio::test]
async fn status_counts_covers_exactly_and_the_limit_is_adjustable() {
    let fx = fixture().await;
    let core = core(&fx);
    common::send(&core.app, get(&format!("/v1/covers?src={SRC}"), None)).await;
    let (_, status) = common::call(&core.app, "GET", "/v1/cache/status", None).await;
    assert_eq!(status["covers"], json!({"bytes": jpeg(500).len(), "count": 1, "limitBytes": 200 * 1024 * 1024}));
    let (_, floor) = common::call(&core.app, "PATCH", "/v1/cache/settings", Some(json!({"coversLimitBytes": 1}))).await;
    assert_eq!(floor["covers"]["limitBytes"], 32 * 1024 * 1024);
    let (_, unlimited) = common::call(&core.app, "PATCH", "/v1/cache/settings", Some(json!({"coversLimitBytes": 0}))).await;
    assert_eq!((unlimited["covers"]["limitBytes"].as_i64(), unlimited["limitBytes"].as_i64()), (Some(0), Some(5 * 1024 * 1024 * 1024)));
    assert_eq!(common::call(&core.app, "PATCH", "/v1/cache/settings", Some(json!({"coversLimitBytes": -1}))).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::call(&core.app, "PATCH", "/v1/cache/settings", Some(json!({}))).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_locked_library_serves_covers_without_writing_them() {
    let fx = fixture().await;
    let first = core(&fx);
    let locked = common::boot_net(first.dir, MemoryKeyStore::with_key([9u8; 32]), &fx.base);
    assert!(locked.state.is_locked());
    let path = format!("/v1/covers?src={SRC}");
    assert_eq!(common::send(&locked.app, get(&path, None)).await.0, StatusCode::OK);
    assert_eq!(common::send(&locked.app, get(&path, None)).await.0, StatusCode::OK);
    assert_eq!(fx.total(), 1, "kept in memory");
    assert_eq!(cover_files(&locked), 0);
}

#[tokio::test]
async fn stray_cover_files_are_removed_at_start() {
    let first = common::core();
    let key = first.state.data().unwrap().master;
    let covers = first.dir.path().join("cache/covers");
    std::fs::write(covers.join("0000orphan.lac"), b"LAC1 left behind").unwrap();
    std::fs::write(covers.join("0000orphan.lac.ab12.part"), b"half").unwrap();
    let config = nuvo_server::Config {
        tools_url: None,
        paths: nuvo_server::paths::Paths::under(first.dir.path()),
        token: common::TOKEN.into(),
        lrclib_url: String::new(), amll_url: String::new(),
        shazam_url: String::new(),
        lastfm_url: String::new(),
        pace: common::FAST,
        exit_on_stdin_eof: false,
        net_rewrite: None,
        env: Default::default(),
        test: Default::default(),
    };
    let state = nuvo_server::AppState::new(config, Box::new(MemoryKeyStore::with_key(key)));
    state.start().await.unwrap();
    assert_eq!(std::fs::read_dir(&covers).unwrap().count(), 0);
}

/// Review focus 5: while the daemon waits on the keyring, covers still load (memory only).
#[tokio::test]
async fn covers_load_while_the_daemon_is_starting() {
    let fx = fixture().await;
    let dir = tempfile::tempdir().unwrap();
    let config = nuvo_server::Config {
        tools_url: None,
        paths: nuvo_server::paths::Paths::under(dir.path()),
        token: common::TOKEN.into(),
        lrclib_url: String::new(), amll_url: String::new(),
        shazam_url: String::new(),
        lastfm_url: String::new(),
        pace: common::FAST,
        exit_on_stdin_eof: false,
        net_rewrite: Some(fx.base.clone()),
        env: Default::default(),
        test: Default::default(),
    };
    let state = nuvo_server::AppState::new(config, Box::new(MemoryKeyStore::default()));
    let app = nuvo_server::router(state.clone());
    assert!(state.is_starting());
    assert_eq!(common::send(&app, get(&format!("/v1/covers?src={SRC}"), None)).await.0, StatusCode::OK);
    assert!(!dir.path().join("cache/covers").exists());
}
