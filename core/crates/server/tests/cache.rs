mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use nuvo_server::routes::cache::{Unsatisfiable, parse_range};
use serde_json::json;

fn upload(id: &str, data: Vec<u8>) -> Request<Body> {
    Request::put(format!("/v1/cache/audio/{id}"))
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", "audio/webm")
        .header("x-nuvo-codec", "opus")
        .body(Body::from(data))
        .unwrap()
}

fn read(id: &str, range: Option<&str>) -> Request<Body> {
    let mut req = Request::get(format!("/v1/cache/audio/{id}")).header("authorization", format!("Bearer {}", common::TOKEN));
    if let Some(range) = range {
        req = req.header("range", range);
    }
    req.body(Body::empty()).unwrap()
}

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 253) as u8).collect()
}

#[test]
fn range_header_parsing() {
    assert_eq!(parse_range("bytes=0-9", 100), Ok(Some((0, 9))));
    assert_eq!(parse_range("bytes=90-", 100), Ok(Some((90, 99))));
    assert_eq!(parse_range("bytes=-10", 100), Ok(Some((90, 99))));
    assert_eq!(parse_range("bytes=50-500", 100), Ok(Some((50, 99))));
    assert_eq!(parse_range("bytes=100-", 100), Err(Unsatisfiable));
    assert_eq!(parse_range("bytes=-0", 100), Err(Unsatisfiable));
    assert_eq!(parse_range("bytes=0-", 0), Err(Unsatisfiable));
    assert_eq!(parse_range("bytes=0-1,5-6", 100), Ok(None));
    assert_eq!(parse_range("items=0-1", 100), Ok(None));
    assert_eq!(parse_range("bytes=x-y", 100), Ok(None));
    assert_eq!(parse_range("bytes=+5-", 100), Ok(None));
    assert_eq!(parse_range("bytes=-+5", 100), Ok(None));
}

#[tokio::test]
async fn upload_then_read_whole_and_ranges() {
    let core = common::core();
    let data = sample(200_000);
    assert_eq!(common::send(&core.app, upload("t1", data.clone())).await.0, StatusCode::NO_CONTENT);

    let (status, body, headers) = common::send(&core.app, read("t1", None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, data);
    assert_eq!(headers["content-type"], "audio/webm");
    assert_eq!(headers["accept-ranges"], "bytes");
    assert_eq!(headers["x-nuvo-codec"], "opus");

    let (status, body, headers) = common::send(&core.app, read("t1", Some("bytes=65530-131080"))).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, &data[65530..=131080]);
    assert_eq!(headers["content-range"], "bytes 65530-131080/200000");

    let (status, _, headers) = common::send(&core.app, read("t1", Some("bytes=999999-"))).await;
    assert_eq!(status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(headers["content-range"], "bytes */200000");
}

#[tokio::test]
async fn misses_bad_uploads_and_deletion() {
    let core = common::core();
    assert_eq!(common::send(&core.app, read("nope", None)).await.0, StatusCode::NOT_FOUND);
    let mut wrong_type = upload("t1", sample(10));
    wrong_type.headers_mut().insert("content-type", "text/html".parse().unwrap());
    assert_eq!(common::send(&core.app, wrong_type).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::send(&core.app, upload("t1", vec![])).await.0, StatusCode::BAD_REQUEST);

    common::send(&core.app, upload("t1", sample(10))).await;
    common::send(&core.app, upload("t2", sample(10))).await;
    assert_eq!(common::call(&core.app, "DELETE", "/v1/cache/audio/t1", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::send(&core.app, read("t1", None)).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "DELETE", "/v1/cache/audio", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/status", None).await.1["entries"], 0);
}

#[tokio::test]
async fn a_deleted_or_corrupt_file_reads_as_a_miss() {
    let core = common::core();
    common::send(&core.app, upload("t1", sample(1000))).await;
    let audio_dir = core.dir.path().join("cache/audio");
    let file = std::fs::read_dir(&audio_dir).unwrap().next().unwrap().unwrap().path();
    let mut bytes = std::fs::read(&file).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    std::fs::write(&file, bytes).unwrap();
    assert_eq!(common::send(&core.app, read("t1", None)).await.0, StatusCode::NOT_FOUND);
    assert!(!file.exists(), "corrupt file is removed");
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/status", None).await.1["entries"], 0);
}

#[tokio::test]
async fn limit_evicts_unprotected_entries_but_keeps_liked_ones() {
    let core = common::core();
    // Bypass the 256 MiB floor of the settings route so the test can use tiny files.
    let data = core.state.data().unwrap();
    data.db.call(|c| nuvo_store::settings::set(c, nuvo_store::settings::CACHE_LIMIT_BYTES, &json!(25))).await.unwrap();
    let liked = json!({"track": {"id": "liked", "title": "L", "artists": [], "durationMs": 1}});
    common::call(&core.app, "PUT", "/v1/me/library/tracks/liked", Some(liked)).await;
    for id in ["liked", "a", "b"] {
        assert_eq!(common::send(&core.app, upload(id, sample(10))).await.0, StatusCode::NO_CONTENT);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    let status = common::call(&core.app, "GET", "/v1/cache/status", None).await.1;
    assert_eq!((status["usedBytes"].as_i64(), status["entries"].as_i64(), status["pinned"].as_i64()), (Some(20), Some(2), Some(1)));
    assert_eq!(common::send(&core.app, read("liked", Some("bytes=0-0"))).await.0, StatusCode::PARTIAL_CONTENT);
    assert_eq!(common::send(&core.app, read("a", Some("bytes=0-0"))).await.0, StatusCode::NOT_FOUND, "oldest unprotected entry goes first");
}

#[tokio::test]
async fn settings_route_enforces_a_floor_and_allows_unlimited() {
    let core = common::core();
    let (_, floor) = common::call(&core.app, "PATCH", "/v1/cache/settings", Some(json!({"limitBytes": 1}))).await;
    assert_eq!(floor["limitBytes"], 256 * 1024 * 1024);
    let (_, unlimited) = common::call(&core.app, "PATCH", "/v1/cache/settings", Some(json!({"limitBytes": 0}))).await;
    assert_eq!(unlimited["limitBytes"], 0);
    assert_eq!(common::call(&core.app, "PATCH", "/v1/cache/settings", Some(json!({"limitBytes": -5}))).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn missing_lists_liked_tracks_to_prefetch() {
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/me/library/tracks/x", Some(json!({"track": {"id": "x", "title": "X"}}))).await;
    let (_, body) = common::call(&core.app, "GET", "/v1/cache/missing?limit=5", None).await;
    assert_eq!(body["items"][0]["id"], "x");
    common::send(&core.app, upload("x", sample(10))).await;
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/missing", None).await.1["items"], json!([]));
}

#[tokio::test]
async fn new_upload_does_not_evict_itself() {
    let core = common::core();
    let data = core.state.data().unwrap();
    data.db.call(|c| nuvo_store::settings::set(c, nuvo_store::settings::CACHE_LIMIT_BYTES, &json!(25))).await.unwrap();
    for id in ["old", "new"] {
        assert_eq!(common::send(&core.app, upload(id, sample(10))).await.0, StatusCode::NO_CONTENT);
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    let status = common::call(&core.app, "GET", "/v1/cache/status", None).await.1;
    assert_eq!((status["usedBytes"].as_i64(), status["entries"].as_i64()), (Some(20), Some(2)), "new entry survives, old one is evicted");
}

#[tokio::test]
async fn truncated_file_reads_as_miss() {
    let core = common::core();
    common::send(&core.app, upload("t1", sample(1000))).await;
    let audio_dir = core.dir.path().join("cache/audio");
    let file = std::fs::read_dir(&audio_dir).unwrap().next().unwrap().unwrap().path();
    std::fs::write(&file, vec![]).unwrap();
    assert_eq!(common::send(&core.app, read("t1", None)).await.0, StatusCode::NOT_FOUND);
    assert!(!file.exists(), "zero-byte file is removed");
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/status", None).await.1["entries"], 0);
}

#[tokio::test]
async fn file_shorter_than_header_reads_as_miss() {
    let core = common::core();
    common::send(&core.app, upload("t1", sample(1000))).await;
    let audio_dir = core.dir.path().join("cache/audio");
    let file = std::fs::read_dir(&audio_dir).unwrap().next().unwrap().unwrap().path();
    let mut bytes = std::fs::read(&file).unwrap();
    bytes.truncate(10);
    std::fs::write(&file, bytes).unwrap();
    assert_eq!(common::send(&core.app, read("t1", None)).await.0, StatusCode::NOT_FOUND);
    assert!(!file.exists(), "truncated file is removed");
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/status", None).await.1["entries"], 0);
}

#[tokio::test]
async fn content_length_over_cap_rejected_immediately() {
    let core = common::core();
    let req = Request::put("/v1/cache/audio/big")
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", "audio/webm")
        .header("content-length", format!("{}", 512 * 1024 * 1024 + 1));
    let status = common::send(&core.app, req.body(Body::empty()).unwrap()).await.0;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn streaming_upload_over_cap_rejected_midway() {
    let core = common::core();
    let huge = vec![0u8; 600 * 1024 * 1024];
    let req = Request::put("/v1/cache/audio/stream")
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", "audio/webm");
    let status = common::send(&core.app, req.body(Body::from(huge)).unwrap()).await.0;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/status", None).await.1["entries"], 0);
    let audio_dir = core.dir.path().join("cache/audio");
    let file_count = std::fs::read_dir(&audio_dir).ok().map(|d| d.count()).unwrap_or(0);
    assert_eq!(file_count, 0, "no cache files should exist after upload rejection");
}

#[cfg(unix)]
#[tokio::test]
async fn start_removes_cache_files_nothing_indexes_and_keeps_the_dir_private() {
    use std::os::unix::fs::PermissionsExt;
    let key = [7u8; 32];
    let first = common::boot(tempfile::tempdir().unwrap(), nuvo_crypto::MemoryKeyStore::with_key(key), "http://127.0.0.1:9");
    assert_eq!(common::send(&first.app, upload("kept", sample(1000))).await.0, StatusCode::NO_CONTENT);
    let audio = first.dir.path().join("cache/audio");
    std::fs::write(audio.join("0000orphan.lac"), b"LAC1 left behind").unwrap();
    std::fs::write(audio.join("0000orphan.lac.ab12.part"), b"half").unwrap();
    std::fs::set_permissions(&audio, std::fs::Permissions::from_mode(0o755)).unwrap();

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
    let state = nuvo_server::AppState::new(config, Box::new(nuvo_crypto::MemoryKeyStore::with_key(key)));
    state.start().await.unwrap();
    let app = nuvo_server::router(state);

    let mut names: Vec<String> = std::fs::read_dir(&audio).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    names.retain(|n| n.contains("orphan"));
    assert!(names.is_empty(), "left {names:?}");
    assert_eq!(common::send(&app, read("kept", None)).await.1, sample(1000));
    assert_eq!(std::fs::metadata(&audio).unwrap().permissions().mode() & 0o777, 0o700);
}
