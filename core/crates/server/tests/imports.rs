mod common;

use std::collections::HashMap;

use axum::http::StatusCode;
use serde_json::{Value, json};

fn track(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "", "name": artist}], "durationMs": ms})
}

/// 50 Exportify rows: 30 found exactly, 10 found 70 s too long, 10 found nowhere.
fn fixture() -> (String, HashMap<String, Vec<Value>>) {
    let mut csv = String::from("Track Name,Artist Name(s),Album Name,Duration (ms)\r\n");
    let mut catalog = HashMap::new();
    for i in 0..50 {
        let (title, artist) = (format!("Song {i}"), format!("Artist {i}"));
        csv.push_str(&format!("{title},\"{artist}\",Album,200000\r\n"));
        let found = match i {
            0..30 => vec![track(&format!("yt{i}"), &title, &artist, 200_500)],
            30..40 => vec![track(&format!("long{i}"), &title, &artist, 270_000)],
            _ => vec![],
        };
        catalog.insert(format!("{artist} {title}"), found);
    }
    (csv, catalog)
}

#[tokio::test]
async fn a_csv_import_runs_to_a_report() {
    let core = common::core();
    let (csv, catalog) = fixture();
    let file = core.dir.path().join("Road Trip.csv");
    std::fs::write(&file, csv).unwrap();
    let (status, started) = common::call(&core.app, "POST", "/v1/fs/imports", Some(json!({"path": file}))).await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let import = &started["items"][0];
    assert_eq!((import["label"].as_str(), import["total"].as_i64(), import["status"].as_str()), (Some("Road Trip"), Some(50), Some("running")));
    let id = import["id"].as_str().unwrap().to_string();
    let playlist = import["targetId"].as_str().unwrap().to_string();

    let mut searches = 0;
    loop {
        let (_, next) = common::call(&core.app, "POST", &format!("/v1/imports/{id}/next"), None).await;
        if next["done"] == true {
            break;
        }
        let search = &next["search"];
        let found = if search["source"] == "youtube" && search["filter"] == "songs" { catalog.get(search["query"].as_str().unwrap()).cloned().unwrap_or_default() } else { vec![] };
        let url = format!("/v1/imports/{id}/rows/{}/candidates", next["rowId"]);
        let (status, _) = common::call(&core.app, "POST", &url, Some(json!({"step": search["step"], "candidates": found}))).await;
        assert_eq!(status, StatusCode::OK);
        searches += 1;
    }
    assert!(searches < 50 * 5, "approved rows stop after one search ({searches})");

    let summary = common::call(&core.app, "GET", &format!("/v1/imports/{id}"), None).await.1;
    assert_eq!(summary["status"], "done");
    assert_eq!(summary["counts"], json!({"exact": 0, "likely": 30, "check": 0, "missing": 20, "already": 0}));
    let detail = common::call(&core.app, "GET", &format!("/v1/me/playlists/{playlist}"), None).await.1;
    assert_eq!(detail["items"].as_array().unwrap().len(), 30);

    let review = common::call(&core.app, "GET", &format!("/v1/imports/{id}/rows?limit=100"), None).await.1;
    let rows = review["items"].as_array().unwrap();
    assert_eq!(rows.len(), 20, "Needs a look is the default");
    assert_eq!((rows[0]["reason"].as_str(), rows[0]["durationDiffMs"].as_i64()), (Some("duration_mismatch"), Some(70_000)));
    assert_eq!(rows[19]["reason"], "no_catalog_candidates");

    let picked = track("pick30", "Song 30", "Artist 30", 200_000);
    let (status, row) = common::call(&core.app, "PATCH", &format!("/v1/imports/{id}/rows/{}", rows[0]["id"]), Some(json!({"decision": "pick", "track": picked}))).await;
    assert_eq!((status, row["decision"].as_str()), (StatusCode::OK, Some("pick")));
    let matched = common::call(&core.app, "GET", &format!("/v1/imports/{id}/rows?label=matched&limit=1"), None).await.1;
    let first = matched["items"][0]["id"].clone();
    common::call(&core.app, "PATCH", &format!("/v1/imports/{id}/rows/{first}"), Some(json!({"decision": "remove"}))).await;
    let detail = common::call(&core.app, "GET", &format!("/v1/me/playlists/{playlist}"), None).await.1;
    let ids: Vec<&str> = detail["items"].as_array().unwrap().iter().map(|i| i["track"]["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), 30);
    assert!(!ids.contains(&"yt0") && ids.contains(&"pick30"));
    assert_eq!(ids[29], "pick30", "a picked track sits at its source position");

    let (status, csv, headers) = common::send(&core.app, common::request("GET", &format!("/v1/imports/{id}/report.csv"), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "text/csv; charset=utf-8");
    let csv = String::from_utf8(csv).unwrap();
    assert_eq!(csv.lines().count(), 51);
    assert!(csv.lines().nth(31).unwrap().starts_with("30,Song 30,Artist 30,Album,200000,missing,"));

    assert_eq!(common::call(&core.app, "DELETE", &format!("/v1/imports/{id}"), None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/imports", None).await.1, json!({"items": []}));
    assert_eq!(common::call(&core.app, "GET", &format!("/v1/me/playlists/{playlist}"), None).await.0, StatusCode::OK, "the playlist stays");
}

#[tokio::test]
async fn rows_from_a_link_and_bad_starts() {
    let core = common::core();
    let rows = json!([{"title": "Song", "artists": ["A"], "track": track("dQw4w9WgXcQ", "Song", "A", 1000)}, {"title": "Other", "artists": ["B"]}]);
    let (status, started) = common::call(&core.app, "POST", "/v1/imports", Some(json!({"source": "youtube-music", "label": "Chill", "rows": rows, "target": {"kind": "liked"}}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((started["items"][0]["counts"]["exact"].as_i64(), started["items"][0]["targetKind"].as_str()), (Some(1), Some("liked")));
    let liked = common::call(&core.app, "GET", "/v1/me/library/tracks", None).await.1;
    assert_eq!(liked["items"][0]["track"]["id"], "dQw4w9WgXcQ");

    let folder = core.dir.path().to_string_lossy().into_owned();
    let bad = [
        json!({"path": "relative.csv"}),
        json!({"path": folder}),
        json!({"path": "/tmp/x.csv", "source": "deezer", "label": "x", "rows": []}),
        json!({"source": "deezer", "label": "x", "rows": [], "target": {"kind": "playlist"}}),
        json!({"source": "napster", "label": "x", "rows": []}),
        json!({"pathh": "/x"}),
    ];
    for body in bad {
        let (status, error) = common::call(&core.app, "POST", "/v1/imports", Some(body.clone())).await;
        assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{body}");
    }
    let (status, _) = common::call(&core.app, "POST", "/v1/fs/imports", Some(json!({"path": "/nonexistent/file.csv"}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "POST", "/v1/imports/nope/next", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn invalid_path_parameters_return_json_400() {
    let core = common::core();
    let (status, error) = common::call(&core.app, "POST", "/v1/imports/bad/rows/notanumber/candidates", Some(json!({"step": 0, "candidates": []}))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));

    let (status, error) = common::call(&core.app, "PATCH", "/v1/imports/bad/rows/notanumber", Some(json!({"decision": "remove"}))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
}

#[tokio::test]
async fn unknown_import_and_row_ids_return_404() {
    let core = common::core();
    assert_eq!(common::call(&core.app, "GET", "/v1/imports/unknown", None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "POST", "/v1/imports/unknown/next", None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "GET", "/v1/imports/unknown/rows", None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "PATCH", "/v1/imports/unknown/rows/1", Some(json!({"decision": "remove"}))).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "POST", "/v1/imports/unknown/rows/1/candidates", Some(json!({"step": 0, "candidates": []}))).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "POST", "/v1/imports/unknown/bulk", Some(json!({"action": "approve-check"}))).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "GET", "/v1/imports/unknown/report.csv", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn invalid_query_parameters() {
    let core = common::core();
    let rows = json!([{"title": "Song", "artists": ["A"], "track": track("test", "Song", "A", 1000)}]);
    let (_, started) = common::call(&core.app, "POST", "/v1/imports", Some(json!({"source": "youtube-music", "label": "Test", "rows": rows}))).await;
    let id = started["items"][0]["id"].as_str().unwrap().to_string();

    let (status, error) = common::call(&core.app, "GET", &format!("/v1/imports/{id}/rows?label=unknown-label"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["code"].as_str(), Some("INVALID_INPUT"));
}

#[tokio::test]
async fn unknown_bulk_action() {
    let core = common::core();
    let rows = json!([{"title": "Song", "artists": ["A"], "track": track("test", "Song", "A", 1000)}]);
    let (_, started) = common::call(&core.app, "POST", "/v1/imports", Some(json!({"source": "youtube-music", "label": "Test", "rows": rows}))).await;
    let id = started["items"][0]["id"].as_str().unwrap().to_string();

    let (status, error) = common::call(&core.app, "POST", &format!("/v1/imports/{id}/bulk"), Some(json!({"action": "invalid-action"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["code"].as_str(), Some("INVALID_INPUT"));
}

#[tokio::test]
async fn oversized_body_returns_413() {
    let core = common::core();
    let huge = "x".repeat(20 * 1024 * 1024 + 1);
    let (status, _) = common::call(&core.app, "POST", "/v1/fs/imports", Some(json!({"path": huge}))).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn a_waiting_song_is_kept_until_cleared() {
    let core = common::core();
    let url = "/v1/imports/pending-track";
    let (status, empty) = common::call(&core.app, "GET", url, None).await;
    assert_eq!((status, &empty["job"]), (StatusCode::OK, &Value::Null));

    let job = json!({"playlistId": "pl-1", "track": track("yt1", "Paper Moons", "Band", 1000)});
    let (status, _) = common::call(&core.app, "PUT", url, Some(job.clone())).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, kept) = common::call(&core.app, "GET", url, None).await;
    assert_eq!(kept["job"], job);

    for bad in [json!({"playlistId": "", "track": track("a", "b", "c", 1)}), json!({"playlistId": "pl-1", "track": {"title": "no id"}}), json!({"playlistId": "pl-1", "track": {"id": "x".repeat(20_000)}}), json!({"track": track("a", "b", "c", 1)})] {
        let (status, _) = common::call(&core.app, "PUT", url, Some(bad)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (_, still) = common::call(&core.app, "GET", url, None).await;
    assert_eq!(still["job"], job);

    let (status, _) = common::call(&core.app, "DELETE", url, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, gone) = common::call(&core.app, "GET", url, None).await;
    assert_eq!(gone["job"], Value::Null);
}

#[tokio::test]
async fn a_page_cannot_name_a_file_but_can_hand_over_its_text() {
    let core = common::core();
    let (csv, _) = fixture();
    let file = core.dir.path().join("Road Trip.csv");
    std::fs::write(&file, &csv).unwrap();
    let (status, error) = common::call(&core.app, "POST", "/v1/imports", Some(json!({"path": file}))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{error}");
    assert_eq!(common::call(&core.app, "GET", "/v1/imports", None).await.1, json!({"items": []}));

    let (status, started) = common::call(&core.app, "POST", "/v1/imports", Some(json!({"file": {"name": "Road Trip.csv", "data": nuvo_crypto::base64_encode(csv.as_bytes())}}))).await;
    assert_eq!(status, StatusCode::OK, "{started}");
    assert_eq!((started["items"][0]["label"].as_str(), started["items"][0]["total"].as_i64()), (Some("Road Trip"), Some(50)));
    let (status, _) = common::call(&core.app, "POST", "/v1/imports", Some(json!({"file": {"name": "x.csv", "data": "YQ=="}, "path": "/x"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_utf16_file_is_read_and_a_big_one_is_refused() {
    let core = common::core();
    let mut utf16 = vec![0xff, 0xfe];
    for unit in "Track Name,Artist Name(s)\nSong,Band\n".encode_utf16() {
        utf16.extend_from_slice(&unit.to_le_bytes());
    }
    let body = |bytes: &[u8]| json!({"file": {"name": "likes.csv", "data": nuvo_crypto::base64_encode(bytes)}});
    let (status, started) = common::call(&core.app, "POST", "/v1/imports", Some(body(&utf16))).await;
    assert_eq!((status, started["items"][0]["total"].as_i64()), (StatusCode::OK, Some(1)), "{started}");

    // Under the 16 MB body limit once encoded, so the file size check is what answers.
    let big = vec![b'a'; nuvo_import::MAX_FILE_BYTES as usize + 1];
    let (status, error) = common::call(&core.app, "POST", "/v1/imports", Some(body(&big))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{error}");
    assert!(error["message"].as_str().unwrap_or_default().contains("10 MB"), "{error}");
}

#[tokio::test]
async fn a_listing_posted_in_pages_keeps_every_page() {
    let core = common::core();
    let page = |from: usize, to: usize| (from..to).map(|i| json!({"title": format!("S{i}"), "artists": ["A"], "track": track(&format!("id{i:09}"), &format!("S{i}"), "A", 1000)})).collect::<Vec<_>>();
    let (_, started) = common::call(&core.app, "POST", "/v1/imports", Some(json!({"source": "soundcloud", "label": "Likes", "rows": page(0, 3)}))).await;
    let id = started["items"][0]["id"].as_str().unwrap().to_string();
    let (status, more) = common::call(&core.app, "POST", &format!("/v1/imports/{id}/rows"), Some(json!({"rows": page(3, 6)}))).await;
    assert_eq!((status, more["total"].as_i64(), more["counts"]["exact"].as_i64()), (StatusCode::OK, Some(6), Some(6)));
    let (status, _) = common::call(&core.app, "POST", &format!("/v1/imports/{id}/rows"), Some(json!({"rows": [], "extra": 1}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(common::call(&core.app, "POST", "/v1/imports/nope/rows", Some(json!({"rows": page(0, 1)}))).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn converter_and_takeout_files_start_imports() {
    let core = common::core();
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../import/tests/fixtures");
    let hand_over = |name: &str| json!({"file": {"name": name, "data": nuvo_crypto::base64_encode(&std::fs::read(fixtures.join(name)).unwrap())}});

    let (status, started) = common::call(&core.app, "POST", "/v1/imports", Some(hand_over("music library songs.csv"))).await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let summary = &started["items"][0];
    assert_eq!((summary["status"].as_str(), summary["total"].as_i64()), (Some("done"), Some(3)), "{summary}");

    let (status, started) = common::call(&core.app, "POST", "/v1/imports", Some(hand_over("tunemymusic.csv"))).await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let labels: Vec<(&str, i64)> = started["items"].as_array().unwrap().iter().map(|s| (s["label"].as_str().unwrap(), s["total"].as_i64().unwrap())).collect();
    assert_eq!(labels, [("Русский рок", 2), ("Anime", 1)]);

    for name in ["soundiiz.xspf", "soundiiz.txt", "soundiiz.json", "spec.xspf"] {
        let (status, started) = common::call(&core.app, "POST", "/v1/imports", Some(hand_over(name))).await;
        assert_eq!(status, StatusCode::OK, "{name}: {started}");
    }
}
