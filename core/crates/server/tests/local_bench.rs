mod common;

use std::time::{Duration, Instant};

/// Run with `cargo test -p nuvo-server --release --test local_bench -- --ignored --nocapture`.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn scanning_20k_files_keeps_audio_requests_fast() {
    let core = common::local_core();
    let warm = tempfile::tempdir().unwrap();
    common::write_wav(&warm.path().join("Warm - Up.wav"), 2);
    common::add_folder(&core, warm.path()).await;
    let page = common::wait_tracks(&core, |p| p["total"] == 1).await;
    let id = page["items"][0]["track"]["id"].as_str().unwrap().to_string();

    let big = tempfile::tempdir().unwrap();
    for i in 0..20_000 {
        common::write_wav(&big.path().join(format!("{:03}/Artist {} - Song {i}.wav", i / 100, i % 50)), 0);
    }
    let started = Instant::now();
    common::add_folder(&core, big.path()).await;
    let mut latencies = Vec::new();
    loop {
        let t = Instant::now();
        let req = axum::http::Request::builder()
            .uri(format!("/v1/local/tracks/{id}/audio"))
            .header("authorization", format!("Bearer {}", common::TOKEN))
            .header("range", "bytes=0-65535")
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(common::send(&core.app, req).await.0, axum::http::StatusCode::PARTIAL_CONTENT);
        latencies.push(t.elapsed());
        let (_, status) = common::call(&core.app, "GET", "/v1/local/status", None).await;
        if status["scanning"] == false && status["read"].as_u64() == Some(20_000) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let first_scan = started.elapsed();
    latencies.sort();
    let p95 = latencies[latencies.len() * 95 / 100];

    let rescan = Instant::now();
    common::call(&core.app, "POST", "/v1/local/rescan", None).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    common::wait_tracks(&core, |p| p["total"].as_i64() == Some(20_001)).await;
    let no_change = rescan.elapsed();
    println!("first scan {first_scan:?}, audio p95 during scan {p95:?} over {} requests, no-change rescan {no_change:?}", latencies.len());
    assert!(p95 < Duration::from_millis(50), "audio p95 {p95:?}");
    assert!(no_change < Duration::from_secs(3), "no-change rescan {no_change:?}");
}

/// Listing the whole library the way the Library tab does (pages of 500) and typing in its filter.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn listing_and_searching_20k_files_stays_quick() {
    let core = common::local_core();
    let big = tempfile::tempdir().unwrap();
    for i in 0..20_000 {
        common::write_wav(&big.path().join(format!("{:03}/Artist {} - Song {i}.wav", i / 100, i % 50)), 0);
    }
    common::add_folder(&core, big.path()).await;
    loop {
        let (_, status) = common::call(&core.app, "GET", "/v1/local/status", None).await;
        if status["scanning"] == false && status["read"].as_u64() == Some(20_000) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    let started = Instant::now();
    let mut cursor = String::new();
    let mut seen = 0;
    loop {
        let (_, page) = common::call(&core.app, "GET", &format!("/v1/local/tracks?limit=500{cursor}"), None).await;
        seen += page["items"].as_array().unwrap().len();
        match page["nextCursor"].as_str() {
            Some(next) => cursor = format!("&cursor={next}"),
            None => break,
        }
    }
    let listing = started.elapsed();

    let mut searches = Vec::new();
    for q in ["song 19", "artist 7", "zzzz", "song"] {
        let t = Instant::now();
        let (_, page) = common::call(&core.app, "GET", &format!("/v1/local/tracks?limit=100&q={}", q.replace(' ', "%20")), None).await;
        assert!(page["total"].as_i64().is_some());
        searches.push(t.elapsed());
    }
    searches.sort();
    println!("listing {seen} files in pages of 500: {listing:?}, search worst {:?}, median {:?}", searches[3], searches[1]);
    assert_eq!(seen, 20_000);
    assert!(listing < Duration::from_secs(3), "listing {listing:?}");
    assert!(searches[3] < Duration::from_millis(100), "search {:?}", searches[3]);
}
