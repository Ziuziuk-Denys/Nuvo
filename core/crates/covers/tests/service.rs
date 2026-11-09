use std::io::Cursor;
use std::time::{Duration, Instant};

use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use nuvo_cache::AudioCache;
use nuvo_covers::{CoverError, Covers, Disk, Limits, Prepared, index, prepare};
use nuvo_net::Net;
use nuvo_net::fixture::{Fixture, Reply};
use nuvo_store::{Db, open_connection, settings};
use serde_json::json;
use tempfile::TempDir;

const FAST: Limits = Limits { timeout: Duration::from_millis(300), negative_ttl: Duration::from_secs(600) };
const SC: &str = "https://i1.sndcdn.com";

fn jpeg(width: u32, height: u32) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(RgbImage::from_pixel(width, height, Rgb([120, 60, 30]))).write_to(&mut out, ImageFormat::Jpeg).unwrap();
    out.into_inner()
}

/// An incompressible 320 x 320 PNG of about 300 KiB that needs no processing at bucket 512.
fn noise_png(seed: u32) -> Vec<u8> {
    let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
    let img = RgbImage::from_fn(320, 320, |_, _| {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        let b = state.to_le_bytes();
        Rgb([b[0], b[1], b[2]])
    });
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(img).write_to(&mut out, ImageFormat::Png).unwrap();
    out.into_inner()
}

fn disk() -> (TempDir, Disk) {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_connection(&dir.path().join("library.db"), &[4u8; 32], &dir.path().join("backups")).unwrap();
    let files = AudioCache::new(dir.path().join("covers"), &[4u8; 32]);
    (dir, Disk { db: Db::new(conn), files })
}

fn req(src: &str, alt: Option<&str>, size: &str) -> Prepared {
    prepare(Some(src), alt, Some(size)).unwrap()
}

fn image(fx: &Fixture, url: &str, bytes: Vec<u8>) {
    fx.on(url, Reply::bytes("image/jpeg", bytes));
}

async fn stored_keys(disk: &Disk) -> Vec<String> {
    disk.db.call(index::by_last_served).await.unwrap().into_iter().map(|e| e.key).collect()
}

#[test]
fn bad_sources_are_refused_up_front() {
    assert_eq!(prepare(Some("https://evil.example/a.jpg"), None, None).unwrap_err(), CoverError::Forbidden("evil.example".into()));
    assert!(matches!(prepare(Some("http://i1.sndcdn.com/artworks-1-large.jpg"), None, None), Err(CoverError::Invalid(_))));
    assert!(matches!(prepare(None, None, None), Err(CoverError::Invalid(_))));
    assert!(matches!(prepare(Some("  "), None, None), Err(CoverError::Invalid(_))));
    assert!(matches!(prepare(Some("https://i1.sndcdn.com/a-large.jpg"), None, Some("abc")), Err(CoverError::Invalid(_))));
    assert!(matches!(prepare(Some("https://i1.sndcdn.com/a-large.jpg"), Some("https://evil.example/b.jpg"), None), Err(CoverError::Forbidden(_))));
}

#[tokio::test]
async fn a_cover_is_fetched_once_and_kept_on_disk() {
    let fx = Fixture::start().await;
    image(&fx, &format!("{SC}/artworks-1-t500x500.jpg"), jpeg(500, 500));
    let (_dir, disk) = disk();
    let covers = Covers::new(fx.net(), FAST);
    let request = req(&format!("{SC}/artworks-1-large.jpg"), None, "300");
    let first = covers.get(&request, Some(disk.clone())).await.unwrap();
    assert_eq!(first.content_type, "image/jpeg");
    assert_eq!(fx.count(&format!("{SC}/artworks-1-t500x500.jpg")), 1);
    assert_eq!(covers.get(&request, Some(disk.clone())).await.unwrap(), first);
    let restarted = Covers::new(fx.net(), FAST);
    assert_eq!(restarted.get(&request, Some(disk.clone())).await.unwrap().bytes, first.bytes);
    assert_eq!(fx.total(), 1);
    assert_eq!(stored_keys(&disk).await, ["i1.sndcdn.com/artworks-1.jpg@512"]);
}

#[tokio::test]
async fn small_buckets_ask_for_small_files() {
    let fx = Fixture::start().await;
    image(&fx, &format!("{SC}/artworks-2-large.jpg"), jpeg(100, 100));
    let covers = Covers::new(fx.net(), FAST);
    covers.get(&req(&format!("{SC}/artworks-2-t500x500.jpg"), None, "40"), None).await.unwrap();
    assert_eq!(fx.log(), ["i1.sndcdn.com/artworks-2-large.jpg"]);
}

#[tokio::test]
async fn missing_sizes_fall_back_to_alt() {
    let fx = Fixture::start().await;
    let alt = format!("{SC}/artworks-3-original.png");
    image(&fx, &alt, jpeg(300, 300));
    let covers = Covers::new(fx.net(), FAST);
    let cover = covers.get(&req(&format!("{SC}/artworks-3-large.jpg"), Some(&alt), "512"), None).await.unwrap();
    assert_eq!(cover.bytes, jpeg(300, 300));
    assert_eq!(fx.log(), ["i1.sndcdn.com/artworks-3-t500x500.jpg", "i1.sndcdn.com/artworks-3-original.png"]);
}

#[tokio::test]
async fn google_artwork_is_sized_by_the_cdn() {
    let fx = Fixture::start().await;
    image(&fx, "https://lh3.googleusercontent.com/abc=w256-h256-l90-rj", jpeg(256, 256));
    let covers = Covers::new(fx.net(), FAST);
    let cover = covers.get(&req("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj", None, "256"), None).await.unwrap();
    assert_eq!(cover.bytes, jpeg(256, 256), "no re-encoding");
}

#[tokio::test]
async fn missing_maxres_thumbnails_fall_back_to_sd() {
    let fx = Fixture::start().await;
    image(&fx, "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg", jpeg(640, 480));
    let covers = Covers::new(fx.net(), FAST);
    let cover = covers.get(&req("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", None, "1024"), None).await.unwrap();
    assert_eq!(image::load_from_memory(&cover.bytes).unwrap().width(), 360, "the 16:9 centre square of a 640 x 480 frame");
    assert_eq!(fx.log(), ["i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", "i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg"]);
}

#[tokio::test]
async fn concurrent_requests_share_one_fetch() {
    let fx = Fixture::start().await;
    fx.on(&format!("{SC}/artworks-4-t500x500.jpg"), Reply::bytes("image/jpeg", jpeg(500, 500)).after(Duration::from_millis(100)));
    let (_dir, disk) = disk();
    let covers = Covers::new(fx.net(), FAST);
    let request = req(&format!("{SC}/artworks-4-large.jpg"), None, "512");
    let calls: Vec<_> = (0..10)
        .map(|_| {
            let (covers, request, disk) = (covers.clone(), request.clone(), disk.clone());
            tokio::spawn(async move { covers.get(&request, Some(disk)).await })
        })
        .collect();
    let mut bodies = Vec::new();
    for call in calls {
        bodies.push(call.await.unwrap().unwrap().bytes);
    }
    assert!(bodies.windows(2).all(|w| w[0] == w[1]));
    assert_eq!(fx.total(), 1);
}

#[tokio::test]
async fn offline_requests_get_another_cached_bucket() {
    let fx = Fixture::start().await;
    image(&fx, &format!("{SC}/artworks-5-t500x500.jpg"), jpeg(500, 500));
    let (_dir, disk) = disk();
    let big = Covers::new(fx.net(), FAST).get(&req(&format!("{SC}/artworks-5-large.jpg"), None, "512"), Some(disk.clone())).await.unwrap();
    let offline = Covers::new(Net::new(Some("http://127.0.0.1:9".into())), FAST);
    let started = Instant::now();
    let served = offline.get(&req(&format!("{SC}/artworks-5-large.jpg"), None, "128"), Some(disk.clone())).await.unwrap();
    assert_eq!(served.bytes, big.bytes);
    assert!(started.elapsed() < Duration::from_millis(250), "a refused connection fails at once");
    let nothing = offline.get(&req(&format!("{SC}/artworks-6-large.jpg"), None, "128"), Some(disk)).await.unwrap_err();
    assert!(matches!(nothing, CoverError::Upstream(_)));
}

#[tokio::test]
async fn missing_covers_are_remembered_for_ten_minutes() {
    let fx = Fixture::start().await;
    let covers = Covers::new(fx.net(), FAST);
    let request = req("https://i.ytimg.com/vi/gone/hqdefault.jpg", None, "256");
    assert_eq!(covers.get(&request, None).await.unwrap_err(), CoverError::NotFound);
    let asked = fx.total();
    assert_eq!(covers.get(&request, None).await.unwrap_err(), CoverError::NotFound);
    assert_eq!(fx.total(), asked);
}

#[tokio::test]
async fn the_least_recently_served_cover_is_evicted_over_the_limit() {
    let fx = Fixture::start().await;
    let (_dir, disk) = disk();
    disk.db.call(|c| settings::set(c, index::LIMIT_KEY, &json!(1024 * 1024))).await.unwrap();
    let covers = Covers::new(fx.net(), FAST);
    let url = |n: u32| format!("{SC}/artworks-1{n}-t500x500.jpg");
    for n in 1..=4 {
        fx.on(&url(n), Reply::bytes("image/png", noise_png(n)));
    }
    for n in [1, 2, 3, 1, 4] {
        covers.get(&req(&url(n), None, "512"), Some(disk.clone())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(3)).await;
    }
    let mut keys = stored_keys(&disk).await;
    keys.sort();
    assert_eq!(keys, ["i1.sndcdn.com/artworks-11.jpg@512", "i1.sndcdn.com/artworks-13.jpg@512", "i1.sndcdn.com/artworks-14.jpg@512"]);
    let (bytes, count) = disk.db.call(index::totals).await.unwrap();
    assert!(bytes <= 1024 * 1024 && count == 3, "{bytes} bytes in {count}");
}

#[tokio::test]
async fn clearing_forgets_every_cover() {
    let fx = Fixture::start().await;
    image(&fx, &format!("{SC}/artworks-7-t500x500.jpg"), jpeg(500, 500));
    let (dir, disk) = disk();
    let covers = Covers::new(fx.net(), FAST);
    let request = req(&format!("{SC}/artworks-7-large.jpg"), None, "512");
    covers.get(&request, Some(disk.clone())).await.unwrap();
    covers.clear(Some(&disk)).await.unwrap();
    assert!(stored_keys(&disk).await.is_empty());
    assert_eq!(std::fs::read_dir(dir.path().join("covers")).unwrap().count(), 0);
    covers.get(&request, Some(disk)).await.unwrap();
    assert_eq!(fx.total(), 2);
}

#[tokio::test]
async fn bad_cdn_answers_are_upstream_errors_and_never_cached() {
    let fx = Fixture::start().await;
    fx.on(&format!("{SC}/a-t500x500.jpg"), Reply::bytes("text/html", "<html>"));
    fx.on(&format!("{SC}/b-t500x500.jpg"), Reply::bytes("image/jpeg", jpeg(10, 10)).after(Duration::from_secs(5)));
    fx.on(&format!("{SC}/c-t500x500.jpg"), Reply::redirect("https://evil.example/x.jpg"));
    fx.on(&format!("{SC}/d-t500x500.jpg"), Reply::bytes("image/jpeg", vec![0u8; 9 * 1024 * 1024]));
    let (_dir, disk) = disk();
    let covers = Covers::new(fx.net(), FAST);
    let get = |name: &str| {
        let (covers, disk, request) = (covers.clone(), disk.clone(), req(&format!("{SC}/{name}-large.jpg"), None, "512"));
        async move { covers.get(&request, Some(disk)).await }
    };
    assert!(matches!(get("a").await, Err(CoverError::Upstream(_))));
    let started = Instant::now();
    assert_eq!(get("b").await.unwrap_err(), CoverError::Timeout);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(matches!(get("c").await, Err(CoverError::Upstream(_))));
    assert!(!fx.hosts().contains(&"evil.example".to_string()));
    assert!(matches!(get("d").await, Err(CoverError::Upstream(_))));
    assert!(stored_keys(&disk).await.is_empty());
}

#[tokio::test]
async fn a_lone_cancelled_request_stores_nothing_but_a_shared_one_completes() {
    let fx = Fixture::start().await;
    fx.on(&format!("{SC}/artworks-8-t500x500.jpg"), Reply::bytes("image/jpeg", jpeg(500, 500)).after(Duration::from_millis(200)));
    let (_dir, disk) = disk();
    let covers = Covers::new(fx.net(), FAST);
    let request = req(&format!("{SC}/artworks-8-large.jpg"), None, "512");
    let lone = tokio::time::timeout(Duration::from_millis(50), covers.get(&request, Some(disk.clone()))).await;
    assert!(lone.is_err());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(stored_keys(&disk).await.is_empty());

    let leaver = tokio::spawn({
        let (covers, request, disk) = (covers.clone(), request.clone(), disk.clone());
        async move { covers.get(&request, Some(disk)).await }
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    let stayer = covers.get(&request, Some(disk.clone()));
    leaver.abort();
    assert!(stayer.await.is_ok());
    assert_eq!(stored_keys(&disk).await.len(), 1);
}

#[tokio::test]
async fn tokenless_artwork_is_downscaled_locally() {
    let fx = Fixture::start().await;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(RgbImage::from_pixel(500, 500, Rgb([1, 2, 3]))).write_to(&mut png, ImageFormat::Png).unwrap();
    fx.on("https://a1.sndcdn.com/images/default_avatar_large.png", Reply::bytes("image/png", png.into_inner()));
    let covers = Covers::new(fx.net(), FAST);
    let cover = covers.get(&req("https://a1.sndcdn.com/images/default_avatar_large.png", None, "40"), None).await.unwrap();
    assert_eq!(cover.content_type, "image/jpeg");
    assert_eq!(image::load_from_memory(&cover.bytes).unwrap().width(), 64);
}

#[tokio::test]
async fn without_a_disk_covers_live_in_memory() {
    let fx = Fixture::start().await;
    image(&fx, &format!("{SC}/artworks-9-t500x500.jpg"), jpeg(500, 500));
    let covers = Covers::new(fx.net(), FAST);
    let request = req(&format!("{SC}/artworks-9-large.jpg"), None, "512");
    let first = covers.get(&request, None).await.unwrap();
    assert_eq!(covers.get(&request, None).await.unwrap(), first);
    assert_eq!(fx.total(), 1);
}

// Hits the real YouTube CDN: cargo test -p nuvo-covers --test service -- --ignored
#[tokio::test]
#[ignore = "network: real cover CDN"]
async fn live_youtube_thumbnail_becomes_a_square() {
    let covers = Covers::new(Net::new(None), Limits::COVERS);
    let cover = covers.get(&req("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", None, "256"), None).await.unwrap();
    let img = image::load_from_memory(&cover.bytes).unwrap();
    assert_eq!((img.width(), img.height()), (256, 256));
}
