mod common;

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};

fn song(id: &str) -> Value {
    json!({"id": id, "title": "Song", "artists": [{"id": "a", "name": "Band"}], "album": {"id": "al", "title": "LP"}, "durationMs": 1000})
}

async fn known(core: &common::TestCore, id: &str) {
    let snapshot = song(id);
    core.state.data().unwrap().db.call(move |c| nuvo_store::tracks::upsert(c, &snapshot, 1).map(|_| ())).await.unwrap();
}

async fn cache(core: &common::TestCore, id: &str) {
    let req = Request::builder()
        .method("PUT")
        .uri(format!("/v1/cache/audio/{id}"))
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", "audio/wav")
        .body(Body::from(common::wav_bytes(1)))
        .unwrap();
    assert_eq!(common::send(&core.app, req).await.0, StatusCode::NO_CONTENT);
}

async fn settled(core: &common::TestCore) -> Value {
    for _ in 0..250 {
        let (_, list) = common::call(&core.app, "GET", "/v1/downloads", None).await;
        if list["items"][0]["status"] != "running" {
            return list["items"][0].clone();
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("download never finished");
}

async fn save(core: &common::TestCore, dir: &std::path::Path, ids: &[&str]) -> (StatusCode, Value) {
    common::call(&core.app, "POST", "/v1/fs/downloads", Some(json!({"dir": dir.to_str().unwrap(), "trackIds": ids, "label": "Mix", "playlistFile": true}))).await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cached_track_is_saved_with_tags_and_a_playlist_file() {
    let core = common::core();
    let out = tempfile::tempdir().unwrap();
    known(&core, "dQw4w9WgXcQ").await;
    cache(&core, "dQw4w9WgXcQ").await;
    assert_eq!(save(&core, out.path(), &["dQw4w9WgXcQ"]).await.0, StatusCode::ACCEPTED);
    let job = settled(&core).await;
    assert_eq!((job["done"].as_i64(), job["status"].as_str()), (Some(1), Some("done")));
    let saved = out.path().join("Band - Song.wav");
    let meta = nuvo_local::tags::read_meta(&saved).unwrap();
    assert_eq!((meta.title.as_str(), meta.album.as_deref()), ("Song", Some("LP")));
    // the job reads as done a moment before the playlist file lands
    for _ in 0..100 {
        if out.path().join("Mix.m3u8").exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(std::fs::read_to_string(out.path().join("Mix.m3u8")).unwrap(), "#EXTM3U\nBand - Song.wav\n");
    assert!(std::fs::read_dir(out.path()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".part")));
}

#[tokio::test(flavor = "multi_thread")]
async fn tracks_wait_for_the_cache_and_can_fail() {
    let core = common::core();
    let out = tempfile::tempdir().unwrap();
    for id in ["aaaaaaaaaaa", "bbbbbbbbbbb"] {
        known(&core, id).await;
    }
    save(&core, out.path(), &["aaaaaaaaaaa", "bbbbbbbbbbb"]).await;
    let (_, waiting) = common::call(&core.app, "GET", "/v1/downloads/waiting?limit=5", None).await;
    assert_eq!(waiting["items"].as_array().unwrap().len(), 2);
    cache(&core, "aaaaaaaaaaa").await;
    assert_eq!(common::call(&core.app, "POST", "/v1/downloads/items/bbbbbbbbbbb/failed", None).await.0, StatusCode::NO_CONTENT);
    let job = settled(&core).await;
    assert_eq!((job["done"].as_i64(), job["failed"].as_i64(), job["status"].as_str()), (Some(1), Some(1), Some("done")));
}

#[tokio::test(flavor = "multi_thread")]
async fn never_overwrites() {
    let core = common::core();
    let out = tempfile::tempdir().unwrap();
    std::fs::write(out.path().join("Band - Song.wav"), b"old").unwrap();
    known(&core, "ccccccccccc").await;
    cache(&core, "ccccccccccc").await;
    save(&core, out.path(), &["ccccccccccc"]).await;
    settled(&core).await;
    assert_eq!(std::fs::read(out.path().join("Band - Song.wav")).unwrap(), b"old");
    assert!(out.path().join("Band - Song (2).wav").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_local_track_is_copied_byte_for_byte() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Me - Mine.wav"), 1);
    common::add_folder(&core, music.path()).await;
    let page = common::wait_tracks(&core, |p| p["total"] == 1).await;
    let id = page["items"][0]["track"]["id"].as_str().unwrap().to_string();
    save(&core, out.path(), &[&id]).await;
    settled(&core).await;
    assert_eq!(std::fs::read(out.path().join("Me - Mine.wav")).unwrap(), std::fs::read(music.path().join("Me - Mine.wav")).unwrap());
}

#[tokio::test]
async fn bad_requests_are_refused() {
    let core = common::core();
    let out = tempfile::tempdir().unwrap();
    known(&core, "ddddddddddd").await;
    let body = |dir: &str, format: &str| json!({"dir": dir, "trackIds": ["ddddddddddd"], "format": format});
    for dir in ["relative", "/etc", "/"] {
        assert_eq!(common::call(&core.app, "POST", "/v1/fs/downloads", Some(body(dir, "original"))).await.0, StatusCode::BAD_REQUEST, "{dir}");
    }
    let own = core.dir.path().join("data");
    std::fs::create_dir_all(&own).unwrap();
    assert_eq!(common::call(&core.app, "POST", "/v1/fs/downloads", Some(body(own.to_str().unwrap(), "original"))).await.0, StatusCode::BAD_REQUEST, "Nuvo's own data");
    let (status, err) = common::call(&core.app, "POST", "/v1/fs/downloads", Some(body(out.path().to_str().unwrap(), "mp3"))).await;
    assert_eq!((status, err["code"].as_str()), (StatusCode::CONFLICT, Some("CONFLICT")), "MP3 needs ffmpeg, absent in tests");
    assert_eq!(common::call(&core.app, "POST", "/v1/fs/downloads", Some(body(out.path().to_str().unwrap(), "flac"))).await.0, StatusCode::BAD_REQUEST);
}

fn files_in(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unrecordable_save_is_marked_failed_and_its_file_deleted() {
    let core = common::core();
    let out = tempfile::tempdir().unwrap();
    known(&core, "eeeeeeeeeee").await;
    cache(&core, "eeeeeeeeeee").await;
    core.state.test.finish_failures.store(1, std::sync::atomic::Ordering::SeqCst);
    save(&core, out.path(), &["eeeeeeeeeee"]).await;
    let job = settled(&core).await;
    assert_eq!((job["done"].as_i64(), job["failed"].as_i64()), (Some(0), Some(1)));
    assert_eq!(files_in(out.path()), Vec::<String>::new(), "no orphan file");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_database_that_refuses_every_record_never_loops_the_worker() {
    let core = common::core();
    let out = tempfile::tempdir().unwrap();
    known(&core, "fffffffffff").await;
    cache(&core, "fffffffffff").await;
    core.state.test.finish_failures.store(1000, std::sync::atomic::Ordering::SeqCst);
    save(&core, out.path(), &["fffffffffff"]).await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(files_in(out.path()), Vec::<String>::new(), "no duplicate files");
    assert_eq!(core.state.test.finish_failures.load(std::sync::atomic::Ordering::SeqCst), 1000 - 3, "saved once, three record attempts");
}

#[tokio::test(flavor = "multi_thread")]
async fn leftovers_of_a_crashed_save_are_cleaned_when_the_daemon_starts() {
    let core = common::core();
    let out = tempfile::tempdir().unwrap();
    known(&core, "ggggggggggg").await;
    cache(&core, "ggggggggggg").await;
    // a job that was queued when the daemon died, with its part file and its empty reserved name
    let input = nuvo_store::downloads::NewDownload { dir: out.path().to_str().unwrap().into(), format: "original".into(), label: "Mix".into(), playlist_file: false, track_ids: vec!["ggggggggggg".into()] };
    core.state.data().unwrap().db.call(move |c| nuvo_store::downloads::create(c, &input, 1).map(|_| ())).await.unwrap();
    std::fs::write(out.path().join(".nuvo-dead.part"), b"half").unwrap();
    std::fs::write(out.path().join("Band - Song.wav"), b"").unwrap();
    std::fs::write(out.path().join("Notes.txt"), b"").unwrap();

    core.state.start().await.unwrap();
    settled(&core).await;
    assert!(!out.path().join(".nuvo-dead.part").exists());
    assert!(!std::fs::read(out.path().join("Band - Song.wav")).unwrap().is_empty(), "saved under the freed name");
    assert!(!out.path().join("Band - Song (2).wav").exists());
    assert!(out.path().join("Notes.txt").exists(), "an unrelated empty file stays");
}
