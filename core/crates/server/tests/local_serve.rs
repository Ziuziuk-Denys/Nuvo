#![cfg(unix)]
mod common;

use std::fs;
use std::os::unix::fs::symlink;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::Value;

async fn scanned(core: &common::TestCore, dir: &std::path::Path, total: u64) -> Value {
    common::add_folder(core, dir).await;
    common::wait_tracks(core, |p| p["total"] == total).await
}

fn get(path: &str, range: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().uri(path).header("authorization", format!("Bearer {}", common::TOKEN));
    if let Some(range) = range {
        builder = builder.header("range", range);
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn audio_is_served_by_range() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    let file = music.path().join("Band - One.wav");
    common::write_wav(&file, 1);
    let page = scanned(&core, music.path(), 1).await;
    let id = page["items"][0]["track"]["id"].as_str().unwrap().to_string();
    let url = format!("/v1/local/tracks/{id}/audio");
    let bytes = fs::read(&file).unwrap();

    let (status, body, headers) = common::send(&core.app, get(&url, Some("bytes=0-3"))).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, &bytes[..4]);
    assert_eq!(headers["content-range"], format!("bytes 0-3/{}", bytes.len()));
    assert_eq!(headers["content-type"], "audio/wav");
    assert_eq!(headers["x-nuvo-codec"], "pcm");
    assert_eq!(headers["cache-control"], "no-store");

    let (status, body, _) = common::send(&core.app, get(&url, None)).await;
    assert_eq!((status, body.len()), (StatusCode::OK, bytes.len()));
    let (status, _, _) = common::send(&core.app, get(&url, Some(&format!("bytes={}-", bytes.len())))).await;
    assert_eq!(status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(common::send(&core.app, get("/v1/local/tracks/abc/audio", None)).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread")]
async fn swapped_for_a_link_is_not_served() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    let secret = tempfile::tempdir().unwrap();
    fs::write(secret.path().join("secret.txt"), b"private").unwrap();
    let file = music.path().join("album/Band - One.wav");
    common::write_wav(&file, 1);
    let page = scanned(&core, music.path(), 1).await;
    let id = page["items"][0]["track"]["id"].as_str().unwrap().to_string();

    // the file itself becomes a link
    fs::remove_file(&file).unwrap();
    symlink(secret.path().join("secret.txt"), &file).unwrap();
    for route in ["audio", "cover"] {
        let (status, body, _) = common::send(&core.app, get(&format!("/v1/local/tracks/{id}/{route}"), None)).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{route}");
        assert!(!String::from_utf8_lossy(&body).contains("private"));
    }
    // the folder becomes a link to a folder that has a file of the same name
    fs::remove_file(&file).unwrap();
    fs::rename(music.path().join("album"), music.path().join("elsewhere")).unwrap();
    common::write_wav(&secret.path().join("Band - One.wav"), 1);
    symlink(secret.path(), music.path().join("album")).unwrap();
    assert_eq!(common::send(&core.app, get(&format!("/v1/local/tracks/{id}/audio"), None)).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread")]
async fn unreadable_files_say_so() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    fs::write(music.path().join("x.m4a"), b"garbage").unwrap();
    let page = scanned(&core, music.path(), 1).await;
    let id = page["items"][0]["track"]["id"].as_str().unwrap();
    let (status, body) = common::call(&core.app, "GET", &format!("/v1/local/tracks/{id}/audio"), None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::UNSUPPORTED_MEDIA_TYPE, Some("UNSUPPORTED_FORMAT")));
}

#[tokio::test(flavor = "multi_thread")]
async fn covers_come_from_the_folder_with_an_etag_and_through_v1_covers() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Band - One.wav"), 1);
    image::RgbImage::new(8, 8).save(music.path().join("cover.png")).unwrap();
    let page = scanned(&core, music.path(), 1).await;
    let id = page["items"][0]["track"]["id"].as_str().unwrap().to_string();
    let (status, body, headers) = common::send(&core.app, get(&format!("/v1/local/tracks/{id}/cover?size=64"), None)).await;
    assert_eq!((status, headers["content-type"].to_str().unwrap()), (StatusCode::OK, "image/png"));
    assert!(!body.is_empty());
    let etag = headers["etag"].to_str().unwrap().to_string();
    let again = Request::builder()
        .uri(format!("/v1/local/tracks/{id}/cover?size=64"))
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("if-none-match", etag)
        .body(Body::empty())
        .unwrap();
    assert_eq!(common::send(&core.app, again).await.0, StatusCode::NOT_MODIFIED);
    let src = page["items"][0]["track"]["cover"]["url"].as_str().unwrap();
    let proxied = format!("/v1/covers?src={}&size=64", src.replace(':', "%3A").replace('/', "%2F"));
    assert_eq!(common::send(&core.app, get(&proxied, None)).await.0, StatusCode::OK);
    let (_, path) = common::call(&core.app, "GET", &format!("/v1/fs/local/tracks/{id}/path"), None).await;
    assert!(path["path"].as_str().unwrap().ends_with("Band - One.wav"));
}
