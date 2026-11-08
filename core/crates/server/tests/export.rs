mod common;

use axum::http::StatusCode;
use serde_json::json;

#[tokio::test(flavor = "multi_thread")]
async fn exports_carry_tracks_never_secrets_and_m3u8_reimports_local_files() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Me - Mine.wav"), 1);
    common::add_folder(&core, music.path()).await;
    let page = common::wait_tracks(&core, |p| p["total"] == 1).await;
    let local = page["items"][0]["track"].clone();
    let yt = json!({"id": "dQw4w9WgXcQ", "title": "Song", "artists": [{"id": "a", "name": "Rick"}], "durationMs": 213000});
    let (_, playlist) = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Mix"}))).await;
    let pid = playlist["id"].as_str().unwrap().to_string();
    for track in [&yt, &local] {
        let path = format!("/v1/me/playlists/{pid}/tracks/{}", track["id"].as_str().unwrap());
        assert!(common::call(&core.app, "POST", &path, Some(json!({"track": track}))).await.0.is_success());
    }
    let secret = "lastfm-session-key-DO-NOT-EXPORT";
    core.state.data().unwrap().db.call(move |c| nuvo_store::settings::set(c, "lastfm_session", &json!(secret))).await.unwrap();

    let (status, body, _) = common::send(&core.app, common::request("GET", &format!("/v1/fs/export/playlists/{pid}?format=m3u8"), None)).await;
    assert_eq!(status, StatusCode::OK);
    let m3u = String::from_utf8(body).unwrap();
    assert!(m3u.contains("https://music.youtube.com/watch?v=dQw4w9WgXcQ") && m3u.contains("Me - Mine.wav"), "{m3u}");
    for format in ["json", "csv"] {
        let (_, body, _) = common::send(&core.app, common::request("GET", &format!("/v1/fs/export/library?format={format}"), None)).await;
        let text = String::from_utf8(body).unwrap();
        assert!(!text.contains(secret) && !text.contains(music.path().to_str().unwrap()), "{format}: {text}");
        assert!(text.contains("Song") && text.contains("Mine"));
    }
    let file = music.path().join("Mix.m3u8");
    std::fs::write(&file, &m3u).unwrap();
    let (_, started) = common::call(&core.app, "POST", "/v1/fs/imports", Some(json!({"path": file.to_str().unwrap()}))).await;
    let (_, rows) = common::call(&core.app, "GET", &format!("/v1/imports/{}/rows?label=all", started["items"][0]["id"].as_str().unwrap()), None).await;
    assert!(rows.to_string().contains(local["id"].as_str().unwrap()), "the local file came back as itself: {rows}");
}

#[tokio::test(flavor = "multi_thread")]
async fn hostile_nuvo_documents_are_refused_or_skipped_never_stored_raw() {
    let core = common::local_core();
    let dir = tempfile::tempdir().unwrap();
    let doc = json!({"format": "nuvo-playlist", "version": 1, "title": "Bad", "tracks": [
        {"id": "x".repeat(5000), "title": "Long id", "artists": [], "durationMs": 1},
        {"id": "local:../../etc/passwd", "title": "Odd id", "artists": [{"id": "", "name": "A"}], "durationMs": 1},
        {"id": "dQw4w9WgXcQ", "title": "T".repeat(100_000), "artists": [{"id": "", "name": "A"}], "durationMs": 1},
        {"id": "dQw4w9WgXcQ", "title": "Fine", "artists": [{"id": "", "name": "A"}], "durationMs": 1}
    ]});
    let file = dir.path().join("bad.json");
    std::fs::write(&file, doc.to_string()).unwrap();
    let (status, started) = common::call(&core.app, "POST", "/v1/fs/imports", Some(json!({"path": file.to_str().unwrap()}))).await;
    assert!(status.is_success() || status.is_client_error(), "{status}: {started}");
    let (_, tracks) = common::call(&core.app, "GET", "/v1/me/playlists", None).await;
    let text = tracks.to_string();
    assert!(!text.contains("../../etc") && !text.contains(&"x".repeat(100)), "{text}");
    let stored: i64 = core
        .state
        .data()
        .unwrap()
        .db
        .call(|c| Ok(c.query_row("SELECT count(*) FROM tracks WHERE length(snapshot_json) > 65536 OR length(id) > 128 OR id LIKE '%..%'", [], |r| r.get(0))?))
        .await
        .unwrap();
    assert_eq!(stored, 0, "nothing oversized or path-like reached the tracks table");
}
