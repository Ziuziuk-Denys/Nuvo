mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use axum::routing::get;
use nuvo_crypto::MemoryKeyStore;
use nuvo_server::precache::{RANGE_BYTES, allowed_host};
use serde_json::{Value, json};

const SIZE: usize = 2 * RANGE_BYTES as usize + 1024 * 1024;
static PROXIED: [u8; 1000] = [7u8; 1000];

fn audio() -> Vec<u8> {
    (0..SIZE).map(|i| (i * 7 % 251) as u8).collect()
}

fn core() -> common::TestCore {
    common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.test.fetch_hosts = vec!["127.0.0.1".into()])
}

fn core_with_timeout(limit: Duration) -> common::TestCore {
    common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| {
        config.test.fetch_hosts = vec!["127.0.0.1".into()];
        config.test.job_timeout = Some(limit);
    })
}

fn partial(start: usize, end: usize, total: usize, body: Vec<u8>) -> Response {
    Response::builder().status(206).header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}")).body(Body::from(body)).unwrap()
}

fn requested_start(headers: &HeaderMap) -> usize {
    let range = headers[header::RANGE].to_str().unwrap().trim_start_matches("bytes=");
    range.split_once('-').unwrap().0.parse().unwrap()
}

fn redirect(location: &'static str) -> Response {
    Response::builder().status(302).header(header::LOCATION, location).body(Body::empty()).unwrap()
}

fn odd_routes() -> axum::Router {
    let flaky_calls = Arc::new(AtomicUsize::new(0));
    axum::Router::new()
        .route("/tiny", get(|headers: HeaderMap| async move { partial(requested_start(&headers), 999, 1000, vec![3u8; 1000 - requested_start(&headers)]) }))
        .route(
            "/flaky",
            get(move |headers: HeaderMap| {
                let calls = flaky_calls.clone();
                async move {
                    if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                        return Response::builder().status(403).body(Body::empty()).unwrap();
                    }
                    partial(requested_start(&headers), 999, 1000, vec![3u8; 1000 - requested_start(&headers)])
                }
            }),
        )
        .route(
            "/exact",
            get(|headers: HeaderMap| async move {
                let total = 2 * RANGE_BYTES as usize;
                let start = requested_start(&headers);
                if start >= total {
                    return Response::builder().status(416).body(Body::empty()).unwrap();
                }
                let end = (start + RANGE_BYTES as usize).min(total) - 1;
                partial(start, end, total, vec![5u8; end - start + 1])
            }),
        )
        .route(
            "/slices",
            get(|headers: HeaderMap| async move {
                let start = requested_start(&headers);
                partial(start, start + 99, 1000, vec![9u8; 100])
            }),
        )
        .route(
            "/short",
            get(|headers: HeaderMap| async move {
                let start = requested_start(&headers);
                if start == 0 { partial(0, 999, 1000, vec![1u8; 600]) } else { partial(start, start, 1000, Vec::new()) }
            }),
        )
        .route(
            "/later200",
            get(|headers: HeaderMap| async move {
                if requested_start(&headers) == 0 { partial(0, 599, 1000, vec![1u8; 600]) } else { Response::builder().status(200).body(Body::from(vec![1u8; 400])).unwrap() }
            }),
        )
        .route("/badstart", get(|| async { partial(5, 9, 1000, vec![0u8; 5]) }))
        .route("/nocr", get(|| async { Response::builder().status(206).body(Body::from(vec![0u8; 10])).unwrap() }))
        .route("/malformed", get(|| async { Response::builder().status(206).header(header::CONTENT_RANGE, "bytes zero-nine/many").body(Body::from(vec![0u8; 10])).unwrap() }))
        .route("/loop", get(|| async { redirect("/loop") }))
        .route("/to-tiny", get(|| async { redirect("/tiny") }))
        .route("/off-list", get(|| async { redirect("https://evil.example/") }))
        .route("/plain-http", get(|| async { redirect("http://x.googlevideo.com/") }))
        .route("/port", get(|| async { redirect("https://x.googlevideo.com:8443/") }))
        .route("/userinfo", get(|| async { redirect("https://u:p@x.googlevideo.com/") }))
}

async fn cdn() -> (String, Arc<AtomicUsize>) {
    let body = Arc::new(audio());
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    let ranged = move |headers: HeaderMap| {
        let (body, seen) = (body.clone(), seen.clone());
        async move {
            seen.fetch_add(1, Ordering::SeqCst);
            let range = headers[header::RANGE].to_str().unwrap().trim_start_matches("bytes=").to_string();
            let (start, end) = range.split_once('-').unwrap();
            let (start, end): (usize, usize) = (start.parse().unwrap(), end.parse::<usize>().unwrap().min(body.len() - 1));
            Response::builder()
                .status(206)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{}", body.len()))
                .body(Body::from(body[start..=end].to_vec()))
                .unwrap()
        }
    };
    let app = axum::Router::new()
        .route("/a", get(ranged))
        .route("/gone", get(|| async { StatusCode::FORBIDDEN }))
        .route("/huge", get(|| async { Response::builder().status(206).header(header::CONTENT_RANGE, "bytes 0-9/600000000").body(Body::from(vec![0u8; 10])).unwrap() }))
        .route(
            "/slow",
            get(|| async {
                let first = futures::stream::once(async { Ok::<_, std::io::Error>(Bytes::from(vec![1u8; 64 * 1024])) });
                let stall = futures::stream::pending::<Result<Bytes, std::io::Error>>();
                Response::builder().status(206).header(header::CONTENT_RANGE, "bytes 0-999999/1000000").body(Body::from_stream(futures::StreamExt::chain(first, stall))).unwrap()
            }),
        )
        .merge(odd_routes());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, count)
}

fn request(track: &str, url: &str) -> Value {
    json!({"trackId": track, "url": url, "mime": "audio/webm", "codec": "opus", "bitrateKbps": 160})
}

async fn settle(core: &common::TestCore, track: &str) -> Value {
    for _ in 0..200 {
        let (_, status) = common::call(&core.app, "GET", &format!("/v1/cache/fetch/{track}"), None).await;
        if status["state"] == "done" || status["state"] == "failed" {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("fetch of {track} never finished");
}

fn partial_files(core: &common::TestCore) -> usize {
    std::fs::read_dir(core.dir.path().join("cache/audio")).map_or(0, |dir| dir.filter(|e| e.as_ref().unwrap().path().to_string_lossy().ends_with(".part")).count())
}

#[tokio::test]
async fn ranged_download_lands_byte_exact_in_the_cache() {
    let core = core();
    let (base, ranges) = cdn().await;
    let (status, body) = common::call(&core.app, "POST", "/v1/cache/fetch", Some(request("t1", &format!("{base}/a")))).await;
    assert_eq!((status, body["state"].as_str()), (StatusCode::ACCEPTED, Some("queued")));
    let done = settle(&core, "t1").await;
    assert_eq!((done["state"].as_str(), done["bytes"].as_u64()), (Some("done"), Some(SIZE as u64)));
    assert_eq!(ranges.load(Ordering::SeqCst), 3, "10 MB ranges");

    let (status, bytes, headers) = common::send(&core.app, common::request("GET", "/v1/cache/audio/t1", None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["x-nuvo-codec"], "opus");
    assert!(bytes == audio(), "the cached copy equals the source");

    let (status, again) = common::call(&core.app, "POST", "/v1/cache/fetch", Some(request("t1", &format!("{base}/a")))).await;
    assert_eq!((status, again["state"].as_str()), (StatusCode::OK, Some("done")), "a cached track is not fetched twice");
}

#[tokio::test]
async fn only_playback_hosts_over_https_are_fetched() {
    for (host, allowed) in [("rr3---sn-4g5e6nsz.googlevideo.com", true), ("cf-media.sndcdn.com", true), ("playback.media-streaming.soundcloud.cloud", true), ("googlevideo.com.evil.example", false), ("evil.example", false), ("127.0.0.1", false)] {
        assert_eq!(allowed_host(host, &[]), allowed, "{host}");
    }
    let core = common::core();
    for url in [
        "https://evil.example/a",
        "http://rr3---sn-x.googlevideo.com/videoplayback",
        "https://user:pw@rr3---sn-x.googlevideo.com/videoplayback",
        "https://rr3---sn-x.googlevideo.com:8443/videoplayback",
        "https://127.0.0.1/a",
        "file:///etc/passwd",
    ] {
        let (status, error) = common::call(&core.app, "POST", "/v1/cache/fetch", Some(request("t1", url))).await;
        assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{url}");
    }
    let mut big = request("t1", "https://evil.example/a");
    big["contentLength"] = json!(600_000_000u64);
    assert_eq!(common::call(&core.app, "POST", "/v1/cache/fetch", Some(big)).await.0, StatusCode::PAYLOAD_TOO_LARGE);
    let mut text = request("t1", "https://evil.example/a");
    text["mime"] = json!("text/html");
    assert_eq!(common::call(&core.app, "POST", "/v1/cache/fetch", Some(text)).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn refusals_and_oversize_streams_fail_without_leftovers() {
    let core = core();
    let (base, _) = cdn().await;
    common::call(&core.app, "POST", "/v1/cache/fetch", Some(request("gone", &format!("{base}/gone")))).await;
    assert_eq!(settle(&core, "gone").await, json!({"state": "failed", "bytes": 0, "code": "unavailable"}), "403 sends the renderer to path B");
    common::call(&core.app, "POST", "/v1/cache/fetch", Some(request("huge", &format!("{base}/huge")))).await;
    assert_eq!(settle(&core, "huge").await["code"], "too_large");
    assert_eq!(partial_files(&core), 0);
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/audio/gone", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cancel_removes_the_partial_file() {
    let core = core();
    let (base, _) = cdn().await;
    common::call(&core.app, "POST", "/v1/cache/fetch", Some(request("slow", &format!("{base}/slow")))).await;
    for _ in 0..200 {
        let status = common::call(&core.app, "GET", "/v1/cache/fetch/slow", None).await.1;
        if status["bytes"].as_u64().unwrap_or(0) > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(partial_files(&core), 1);
    assert_eq!(common::call(&core.app, "DELETE", "/v1/cache/fetch/slow", None).await.0, StatusCode::NO_CONTENT);
    for _ in 0..100 {
        if partial_files(&core) == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(partial_files(&core), 0);
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/fetch/slow", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_proxy_carries_the_download() {
    let core = core();
    let (proxy, count) = common::proxy::answering(&PROXIED, None).await;
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": proxy}))).await;
    // Port 9 is closed: only the proxy can answer.
    common::call(&core.app, "POST", "/v1/cache/fetch", Some(request("p1", "http://127.0.0.1:9/a"))).await;
    assert_eq!(settle(&core, "p1").await, json!({"state": "done", "bytes": 1000}));
    assert_eq!(count.load(Ordering::SeqCst), 1, "a server that ignores Range is read whole");
    let (_, bytes, _) = common::send(&core.app, common::request("GET", "/v1/cache/audio/p1", None)).await;
    assert_eq!(bytes, PROXIED);
}

async fn post(core: &common::TestCore, track: &str, url: &str) -> (StatusCode, Value) {
    common::call(&core.app, "POST", "/v1/cache/fetch", Some(request(track, url))).await
}

async fn delete(core: &common::TestCore, track: &str) {
    assert_eq!(common::call(&core.app, "DELETE", &format!("/v1/cache/fetch/{track}"), None).await.0, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn cancel_after_done_keeps_capacity() {
    let core = core();
    let (base, _) = cdn().await;
    post(&core, "t1", &format!("{base}/tiny")).await;
    assert_eq!(settle(&core, "t1").await["state"], "done");
    delete(&core, "t1").await;
    for track in ["s1", "s2"] {
        assert_eq!(post(&core, track, &format!("{base}/slow")).await.0, StatusCode::ACCEPTED, "{track}");
    }
}

#[tokio::test]
async fn many_finished_and_cancelled_jobs_never_lock_the_queue() {
    let core = core();
    let (base, _) = cdn().await;
    for n in 0..60 {
        let track = format!("m{n}");
        assert_eq!(post(&core, &track, &format!("{base}/tiny")).await.0, StatusCode::ACCEPTED, "{track}");
        assert_eq!(settle(&core, &track).await["state"], "done");
        if n % 2 == 0 {
            delete(&core, &track).await;
        }
    }
    assert_eq!(post(&core, "last", &format!("{base}/slow")).await.0, StatusCode::ACCEPTED);
}

#[tokio::test]
async fn third_concurrent_fetch_is_429_and_slot_frees() {
    let core = core();
    let (base, _) = cdn().await;
    let slow = format!("{base}/slow");
    assert_eq!(post(&core, "s1", &slow).await.0, StatusCode::ACCEPTED);
    assert_eq!(post(&core, "s2", &slow).await.0, StatusCode::ACCEPTED);
    let (status, error) = post(&core, "s3", &slow).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::TOO_MANY_REQUESTS, Some("CONFLICT")));
    delete(&core, "s1").await;
    assert_eq!(post(&core, "s3", &slow).await.0, StatusCode::ACCEPTED);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_posts_for_one_track_start_one_job() {
    let core = core();
    let (base, _) = cdn().await;
    let slow = format!("{base}/slow");
    let calls = (0..16).map(|_| async { post(&core, "same", &slow).await.0 });
    for status in futures::future::join_all(calls).await {
        assert_eq!(status, StatusCode::ACCEPTED);
    }
    assert_eq!(post(&core, "other", &slow).await.0, StatusCode::ACCEPTED, "the track took one slot");
    assert_eq!(post(&core, "third", &slow).await.0, StatusCode::TOO_MANY_REQUESTS);
    delete(&core, "same").await;
    assert_eq!(post(&core, "third", &slow).await.0, StatusCode::ACCEPTED, "cancelling frees exactly one slot");
    assert_eq!(post(&core, "fourth", &slow).await.0, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn failed_fetch_can_be_retried() {
    let core = core();
    let (base, _) = cdn().await;
    let url = format!("{base}/flaky");
    post(&core, "f1", &url).await;
    assert_eq!(settle(&core, "f1").await["state"], "failed");
    let (status, again) = post(&core, "f1", &url).await;
    assert_eq!((status, again["state"].as_str()), (StatusCode::ACCEPTED, Some("queued")));
    assert_eq!(settle(&core, "f1").await["state"], "done");
}

#[tokio::test]
async fn redirect_to_off_list_host_http_port_or_userinfo_is_refused() {
    let core = core();
    let (base, _) = cdn().await;
    for path in ["off-list", "plain-http", "port", "userinfo"] {
        let track = format!("r-{path}");
        post(&core, &track, &format!("{base}/{path}")).await;
        let done = settle(&core, &track).await;
        assert_eq!((done["state"].as_str(), done["code"].as_str()), (Some("failed"), Some("blocked")), "{path}");
    }
    assert_eq!(partial_files(&core), 0);
}

#[tokio::test]
async fn redirect_to_allowed_test_host_is_followed() {
    let core = core();
    let (base, _) = cdn().await;
    post(&core, "r1", &format!("{base}/to-tiny")).await;
    assert_eq!(settle(&core, "r1").await, json!({"state": "done", "bytes": 1000}));
}

#[tokio::test]
async fn redirect_loop_is_capped() {
    let core = core();
    let (base, _) = cdn().await;
    post(&core, "loop", &format!("{base}/loop")).await;
    let done = settle(&core, "loop").await;
    assert_eq!((done["state"].as_str(), done["code"].as_str()), (Some("failed"), Some("blocked")));
}

#[tokio::test]
async fn bad_content_range_fails() {
    let core = core();
    let (base, _) = cdn().await;
    for path in ["badstart", "nocr", "malformed"] {
        let track = format!("c-{path}");
        post(&core, &track, &format!("{base}/{path}")).await;
        let done = settle(&core, &track).await;
        assert_eq!((done["state"].as_str(), done["code"].as_str()), (Some("failed"), Some("server_error")), "{path}");
    }
    assert_eq!(partial_files(&core), 0);
}

#[tokio::test]
async fn short_body_vs_total_fails_and_a_whole_body_for_a_later_range_is_refused() {
    let core = core();
    let (base, _) = cdn().await;
    for path in ["short", "later200"] {
        let track = format!("i-{path}");
        post(&core, &track, &format!("{base}/{path}")).await;
        let done = settle(&core, &track).await;
        assert_eq!((done["state"].as_str(), done["code"].as_str()), (Some("failed"), Some("server_error")), "{path}");
    }
    assert_eq!(partial_files(&core), 0);
}

#[tokio::test]
async fn exact_multiple_of_range_size_completes() {
    let core = core();
    let (base, _) = cdn().await;
    post(&core, "exact", &format!("{base}/exact")).await;
    assert_eq!(settle(&core, "exact").await, json!({"state": "done", "bytes": 2 * RANGE_BYTES}));
}

#[tokio::test]
async fn a_host_that_serves_short_ranges_completes() {
    let core = core();
    let (base, _) = cdn().await;
    post(&core, "slices", &format!("{base}/slices")).await;
    assert_eq!(settle(&core, "slices").await, json!({"state": "done", "bytes": 1000}));
}

#[tokio::test]
async fn job_timeout_removes_partial() {
    let core = core_with_timeout(Duration::from_millis(600));
    let (base, _) = cdn().await;
    post(&core, "late", &format!("{base}/slow")).await;
    let done = settle(&core, "late").await;
    assert_eq!((done["state"].as_str(), done["code"].as_str()), (Some("failed"), Some("timeout")));
    assert_eq!(partial_files(&core), 0);
}

#[tokio::test]
async fn stale_generation_does_not_overwrite_new_job() {
    let core = core();
    let (base, _) = cdn().await;
    post(&core, "again", &format!("{base}/slow")).await;
    for _ in 0..200 {
        if common::call(&core.app, "GET", "/v1/cache/fetch/again", None).await.1["bytes"].as_u64().unwrap_or(0) > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    delete(&core, "again").await;
    post(&core, "again", &format!("{base}/tiny")).await;
    assert_eq!(settle(&core, "again").await, json!({"state": "done", "bytes": 1000}));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(common::call(&core.app, "GET", "/v1/cache/fetch/again", None).await.1["state"], "done", "the drained old run left the new status alone");
    assert_eq!(partial_files(&core), 0);
}
