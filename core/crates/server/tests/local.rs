mod common;

use std::fs;

use axum::http::StatusCode;
use nuvo_local::walk::Found;
use nuvo_server::local::{Pending, plan};
use nuvo_store::local::KnownFile;
use serde_json::Value;

fn titles(page: &Value) -> Vec<String> {
    page["items"].as_array().unwrap().iter().map(|i| i["track"]["title"].as_str().unwrap().to_string()).collect()
}

fn id_of(page: &Value, title: &str) -> String {
    page["items"].as_array().unwrap().iter().find(|i| i["track"]["title"] == title).unwrap()["track"]["id"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn adding_a_folder_scans_and_lists_it() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Band - One.wav"), 1);
    common::write_wav(&music.path().join("sub/Band - Two.wav"), 1);
    fs::write(music.path().join("broken.mp3"), b"nope").unwrap();
    let (status, root) = common::add_folder(&core, music.path()).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(root["path"], fs::canonicalize(music.path()).unwrap().to_str().unwrap());
    let page = common::wait_tracks(&core, |p| p["total"] == 3).await;
    // ordered by artist: "Band" before the unreadable file's "Unknown Artist"
    assert_eq!(titles(&page), ["One", "Two", "broken"]);
    assert_eq!(page["items"][2]["unsupported"], "unreadable");
    assert_eq!(page["items"][0]["lossless"], true);
    let (_, status) = common::call(&core.app, "GET", "/v1/local/status", None).await;
    assert_eq!((status["added"].as_u64(), status["unreadable"].as_u64()), (Some(3), Some(1)));
    let (_, roots) = common::call(&core.app, "GET", "/v1/local/roots", None).await;
    assert_eq!(roots["items"][0]["files"], 3);
    let (_, found) = common::call(&core.app, "GET", "/v1/local/tracks?q=two", None).await;
    assert_eq!(titles(&found), ["Two"]);
}

#[tokio::test]
async fn bad_folders_are_refused() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("a.wav"), 1);
    assert_eq!(common::call(&core.app, "POST", "/v1/fs/local/roots", Some(serde_json::json!({"path": "relative/dir"}))).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::add_folder(&core, std::path::Path::new("/")).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::add_folder(&core, std::path::Path::new("/etc")).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::add_folder(&core, &music.path().join("a.wav")).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::add_folder(&core, &music.path().join("gone")).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::add_folder(&core, &core.dir.path().join("data")).await.0, StatusCode::BAD_REQUEST, "Nuvo's own data");
    assert_eq!(common::add_folder(&core, music.path()).await.0, StatusCode::ACCEPTED);
    fs::create_dir(music.path().join("inner")).unwrap();
    assert_eq!(common::add_folder(&core, &music.path().join("inner")).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_watcher_follows_new_moved_and_deleted_files() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Band - Keep.wav"), 1);
    common::add_folder(&core, music.path()).await;
    let page = common::wait_tracks(&core, |p| p["total"] == 1).await;
    let id = id_of(&page, "Keep");

    common::write_wav(&music.path().join("Band - New.wav"), 1);
    common::wait_tracks(&core, |p| p["total"] == 2).await;

    fs::create_dir(music.path().join("moved")).unwrap();
    fs::rename(music.path().join("Band - Keep.wav"), music.path().join("moved/Band - Keep.wav")).unwrap();
    // The page has no paths, so wait for the scan that saw the old path vanish.
    for _ in 0..250 {
        let (_, status) = common::call(&core.app, "GET", "/v1/local/status", None).await;
        if status["scanning"] == false && status["removed"] == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let page = common::wait_tracks(&core, |p| p["total"] == 2).await;
    assert_eq!(id_of(&page, "Keep"), id, "a moved file keeps its id");
    let (_, status) = common::call(&core.app, "GET", "/v1/local/status", None).await;
    assert_eq!((status["added"].as_u64(), status["removed"].as_u64()), (Some(0), Some(1)), "moved, not new");

    fs::remove_file(music.path().join("Band - New.wav")).unwrap();
    common::wait_tracks(&core, |p| p["total"] == 1).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn unplugged_folder_keeps_rows_and_removing_a_folder_clears_it() {
    let core = common::local_core();
    let parent = tempfile::tempdir().unwrap();
    let music = parent.path().join("drive");
    common::write_wav(&music.join("Band - One.wav"), 1);
    let (_, root) = common::add_folder(&core, &music).await;
    common::wait_tracks(&core, |p| p["total"] == 1).await;
    fs::rename(&music, parent.path().join("unplugged")).unwrap();
    common::call(&core.app, "POST", "/v1/local/rescan", None).await;
    common::wait_tracks(&core, |p| p["total"] == 0).await;
    let (_, roots) = common::call(&core.app, "GET", "/v1/local/roots", None).await;
    assert_eq!((roots["items"][0]["status"].as_str(), roots["items"][0]["files"].as_i64()), (Some("missing"), Some(1)));
    fs::rename(parent.path().join("unplugged"), &music).unwrap();
    common::call(&core.app, "POST", "/v1/local/rescan", None).await;
    common::wait_tracks(&core, |p| p["total"] == 1).await;
    let path = format!("/v1/local/roots/{}", root["id"]);
    assert_eq!(common::call(&core.app, "DELETE", &path, None).await.0, StatusCode::NO_CONTENT);
    common::wait_tracks(&core, |p| p["total"] == 0).await;
}

#[test]
fn plan_reads_only_what_changed() {
    let known = |path: &str, id: &str, size: i64, mtime: i64| KnownFile { path: path.into(), track_id: id.into(), size_bytes: size, mtime_ms: mtime, has_lrc: false, folder_art: Some(false) };
    let found = |path: &str, size: u64, mtime: i64| Found { path: path.into(), size, mtime_ms: mtime, lrc: None, folder_art: false };
    let p = plan(
        &[known("/m/same", "local:a", 1, 1), known("/m/edited", "local:b", 1, 1), known("/m/old", "local:c", 7, 7), known("/m/gone", "local:d", 9, 9)],
        &[found("/m/same", 1, 1), found("/m/edited", 2, 2), found("/m/new-place", 7, 7), found("/m/fresh", 3, 3)],
    );
    assert_eq!(p.unchanged, 1);
    assert_eq!(p.read, vec![
        Pending { found: found("/m/edited", 2, 2), track_id: Some("local:b".into()) },
        Pending { found: found("/m/new-place", 7, 7), track_id: Some("local:c".into()) },
        Pending { found: found("/m/fresh", 3, 3), track_id: None },
    ]);
    assert_eq!(p.removed, ["/m/old", "/m/gone"]);
}

#[test]
fn plan_reads_a_file_again_when_its_folder_art_changed_or_is_unknown() {
    let known = |path: &str, folder_art| KnownFile { path: path.into(), track_id: "local:a".into(), size_bytes: 1, mtime_ms: 1, has_lrc: false, folder_art };
    let found = |path: &str, folder_art| Found { path: path.into(), size: 1, mtime_ms: 1, lrc: None, folder_art };
    assert_eq!(plan(&[known("/m/a", Some(true))], &[found("/m/a", true)]).unchanged, 1);
    assert_eq!(plan(&[known("/m/a", Some(false))], &[found("/m/a", true)]).read.len(), 1, "a cover image was added");
    assert_eq!(plan(&[known("/m/a", Some(true))], &[found("/m/a", false)]).read.len(), 1, "the cover image is gone");
    assert_eq!(plan(&[known("/m/a", None)], &[found("/m/a", false)]).read.len(), 1, "scanned before the folder art was kept");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_file_gets_a_cover_url_only_while_it_has_a_picture() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Band - Song.wav"), 1);
    common::add_folder(&core, music.path()).await;
    let page = common::wait_tracks(&core, |p| p["total"] == 1).await;
    assert!(page["items"][0]["track"].get("cover").is_none());
    let art = music.path().join("cover.png");
    image::RgbImage::new(4, 4).save(&art).unwrap();
    common::wait_tracks(&core, |p| p["items"][0]["track"]["cover"]["url"].is_string()).await;
    std::fs::remove_file(&art).unwrap();
    common::wait_tracks(&core, |p| p["items"][0]["track"].get("cover").is_none()).await;
}

#[tokio::test]
async fn a_folder_holding_nuvos_data_is_refused() {
    let core = common::local_core();
    assert_eq!(common::add_folder(&core, core.dir.path()).await.0, StatusCode::BAD_REQUEST, "parent of the data and cache folders");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_storm_of_changes_still_gets_scanned() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Band - 0.wav"), 1);
    common::add_folder(&core, music.path()).await;
    common::wait_tracks(&core, |p| p["total"] == 1).await;
    let dir = music.path().to_path_buf();
    // a change every 10 ms for 3 s: each arrives before the 30 ms quiet time ends
    let storm = tokio::task::spawn_blocking(move || {
        for n in 1..300 {
            common::write_wav(&dir.join(format!("Band - {n}.wav")), 1);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    });
    let started = std::time::Instant::now();
    let mut seen = 0;
    while started.elapsed() < std::time::Duration::from_millis(2500) && seen < 3 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let (_, page) = common::call(&core.app, "GET", "/v1/local/tracks?limit=500", None).await;
        seen = page["total"].as_i64().unwrap_or(0);
    }
    assert!(seen >= 3, "no scan ran during the storm, tracks: {seen}");
    storm.await.unwrap();
}

#[tokio::test]
async fn pages_follow_the_cursor_without_repeats_or_gaps() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    for name in ["Band - A", "Band - B", "Band - C", "Other - D", "Other - E"] {
        common::write_wav(&music.path().join(format!("{name}.wav")), 1);
    }
    common::add_folder(&core, music.path()).await;
    common::wait_tracks(&core, |p| p["total"] == 5).await;
    let mut seen = Vec::new();
    let mut path = "/v1/local/tracks?limit=2".to_string();
    loop {
        let (_, page) = common::call(&core.app, "GET", &path, None).await;
        assert_eq!(page["total"], 5);
        seen.extend(titles(&page));
        match page["nextCursor"].as_str() {
            Some(next) => path = format!("/v1/local/tracks?limit=2&cursor={next}"),
            None => break,
        }
    }
    assert_eq!(seen, ["A", "B", "C", "D", "E"]);
    let (status, _) = common::call(&core.app, "GET", "/v1/local/tracks?cursor=nonsense", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
