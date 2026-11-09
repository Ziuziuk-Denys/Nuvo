mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

fn track(id: &str) -> Value {
    json!({"id": id, "title": id, "artists": [{"id": "a", "name": "Artist"}], "durationMs": 1000})
}

#[tokio::test]
async fn playlist_lifecycle_over_http() {
    let core = common::core();
    let (status, created) = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Mine", "description": "d"}))).await;
    assert_eq!(status, StatusCode::OK);
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!((created["isPublic"].as_bool(), created["revision"].as_i64()), (Some(false), Some(1)));

    let base = format!("/v1/me/playlists/{id}");
    for t in ["a", "b", "c"] {
        let (status, item) = common::call(&core.app, "POST", &format!("{base}/tracks/{t}"), Some(json!({"track": track(t), "trackSnapshot": track(t)}))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(item["track"]["id"], t);
    }
    let (status, dup) = common::call(&core.app, "POST", &format!("{base}/tracks/a"), Some(json!({"track": track("a")}))).await;
    assert_eq!((status, dup["code"].as_str()), (StatusCode::CONFLICT, Some("CONFLICT")));

    let (_, view) = common::call(&core.app, "GET", &base, None).await;
    let items = view["items"].as_array().unwrap();
    let revision = view["playlist"]["revision"].as_i64().unwrap();
    let (c_id, a_id) = (items[2]["id"].as_str().unwrap(), items[0]["id"].as_str().unwrap());

    let (status, moved) = common::call(&core.app, "POST", &format!("{base}/items/{c_id}/move"), Some(json!({"beforeItemId": a_id, "revision": revision}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(moved["items"][0]["track"]["id"], "c");
    let (status, _) = common::call(&core.app, "POST", &format!("{base}/items/{c_id}/move"), Some(json!({"beforeItemId": null, "revision": revision}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "stale revision");

    assert_eq!(common::call(&core.app, "DELETE", &format!("{base}/items/{a_id}"), None).await.0, StatusCode::NO_CONTENT);
    let (_, patched) = common::call(&core.app, "PATCH", &base, Some(json!({"title": "Renamed", "description": null}))).await;
    assert_eq!(patched["title"], "Renamed");
    assert!(patched.get("description").is_none());

    let (_, list) = common::call(&core.app, "GET", "/v1/me/playlists", None).await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    assert_eq!(common::call(&core.app, "DELETE", &base, None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", &base, None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn bulk_import_reports_added_count() {
    let core = common::core();
    let id = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Import"}))).await.1["id"].as_str().unwrap().to_string();
    let tracks: Vec<Value> = (0..300).map(|i| track(&format!("t{i}"))).chain([json!({"bad": true})]).collect();
    let (status, result) = common::call(&core.app, "POST", &format!("/v1/me/playlists/{id}/tracks"), Some(json!({"tracks": tracks}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((result["added"].as_u64(), result["rejected"].as_u64()), (Some(300), Some(1)));
}

#[tokio::test]
async fn missing_title_is_invalid_input() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"description": "no title"}))).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
}

#[tokio::test]
async fn sort_is_saved_through_patch_and_applied_to_the_detail() {
    let core = common::core();
    let id = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Sorted"}))).await.1["id"].as_str().unwrap().to_string();
    let base = format!("/v1/me/playlists/{id}");
    for (t, ms) in [("short", 1000), ("long", 9000), ("mid", 5000)] {
        let snapshot = json!({"id": t, "title": t, "artists": [{"id": "a", "name": "Artist"}], "durationMs": ms});
        common::call(&core.app, "POST", &format!("{base}/tracks/{t}"), Some(json!({"track": snapshot}))).await;
    }
    let (status, patched) = common::call(&core.app, "PATCH", &base, Some(json!({"sortMode": "duration", "sortDesc": true}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((patched["sortMode"].as_str(), patched["sortDesc"].as_bool()), (Some("duration"), Some(true)));
    let (_, view) = common::call(&core.app, "GET", &base, None).await;
    let ids: Vec<&str> = view["items"].as_array().unwrap().iter().map(|i| i["track"]["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["long", "mid", "short"]);
    assert_eq!(view["playlist"]["sortMode"], "duration");

    let (status, body) = common::call(&core.app, "PATCH", &base, Some(json!({"sortMode": "shuffle"}))).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
}

fn put_cover(id: &str, content_type: &str, bytes: Vec<u8>) -> axum::http::Request<axum::body::Body> {
    axum::http::Request::put(format!("/v1/me/playlists/{id}/cover"))
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", content_type)
        .body(axum::body::Body::from(bytes))
        .unwrap()
}

fn webp(len: usize) -> Vec<u8> {
    let mut bytes = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
    bytes.resize(len, 7);
    bytes
}

#[tokio::test]
async fn cover_upload_serve_and_remove() {
    let core = common::core();
    let id = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Art"}))).await.1["id"].as_str().unwrap().to_string();

    let (status, body, _) = common::send(&core.app, put_cover(&id, "image/webp", webp(2048))).await;
    assert_eq!(status, StatusCode::OK);
    let playlist: Value = serde_json::from_slice(&body).unwrap();
    let url = playlist["coverUrl"].as_str().unwrap();
    assert!(url.starts_with(&format!("nuvo-core://local/v1/me/playlists/{id}/cover?v=")), "{url}");

    let (status, bytes, headers) = common::send(&core.app, common::request("GET", &format!("/v1/me/playlists/{id}/cover"), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, webp(2048));
    assert_eq!(headers["content-type"], "image/webp");
    assert_eq!(headers["x-content-type-options"], "nosniff");
    let (_, list) = common::call(&core.app, "GET", "/v1/me/playlists", None).await;
    assert_eq!(list["items"][0]["coverUrl"], url);

    assert_eq!(common::call(&core.app, "DELETE", &format!("/v1/me/playlists/{id}/cover"), None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}/cover"), None).await.0, StatusCode::NOT_FOUND);
    let (_, detail) = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}"), None).await;
    assert!(detail["playlist"].get("coverUrl").is_none());
}

#[tokio::test]
async fn cover_uploads_are_checked() {
    let core = common::core();
    let id = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Art"}))).await.1["id"].as_str().unwrap().to_string();
    let png = b"\x89PNG\r\n\x1a\nrest".to_vec();

    assert_eq!(common::send(&core.app, put_cover(&id, "image/png", png.clone())).await.0, StatusCode::OK);
    assert_eq!(common::send(&core.app, put_cover(&id, "image/jpeg", vec![0xFF, 0xD8, 0xFF, 0xE0])).await.0, StatusCode::OK);
    assert_eq!(common::send(&core.app, put_cover(&id, "image/gif", b"GIF89a".to_vec())).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::send(&core.app, put_cover(&id, "image/jpeg", png)).await.0, StatusCode::BAD_REQUEST, "bytes must match the type");
    assert_eq!(common::send(&core.app, put_cover(&id, "image/webp", vec![])).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::send(&core.app, put_cover(&id, "image/webp", webp(400 * 1024))).await.0, StatusCode::OK, "400 KB is allowed");
    assert_eq!(common::send(&core.app, put_cover(&id, "image/webp", webp(400 * 1024 + 1))).await.0, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(common::send(&core.app, put_cover(&id, "image/webp", webp(1024 * 1024))).await.0, StatusCode::PAYLOAD_TOO_LARGE, "1 MB is rejected at the layer");
    let (_, body, _) = common::send(&core.app, put_cover(&id, "image/webp", webp(1024 * 1024))).await;
    let json: Value = serde_json::from_slice(&body).expect("413 body is JSON");
    assert_eq!(json["code"], "INVALID_INPUT");
    assert_eq!(common::send(&core.app, put_cover("missing", "image/webp", webp(64))).await.0, StatusCode::NOT_FOUND);
}

async fn playlist_with(core: &common::TestCore, title: &str, tracks: &[&str]) -> String {
    let id = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": title}))).await.1["id"].as_str().unwrap().to_string();
    for t in tracks {
        common::call(&core.app, "POST", &format!("/v1/me/playlists/{id}/tracks/{t}"), Some(json!({"track": track(t)}))).await;
    }
    id
}

async fn track_order(core: &common::TestCore, id: &str) -> (Vec<String>, Value) {
    let (_, view) = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}"), None).await;
    let ids = view["items"].as_array().unwrap().iter().map(|i| i["track"]["id"].as_str().unwrap().to_string()).collect();
    (ids, view)
}

#[tokio::test]
async fn move_to_another_playlist_and_undo() {
    let core = common::core();
    let source = playlist_with(&core, "Source", &["a", "b", "c"]).await;
    let target = playlist_with(&core, "Target", &["c"]).await;
    let (_, view) = track_order(&core, &source).await;
    let picked: Vec<Value> = view["items"].as_array().unwrap().iter().filter(|i| i["track"]["id"] != "a").cloned().collect();
    let picked_ids: Vec<&str> = picked.iter().map(|i| i["id"].as_str().unwrap()).collect();

    let (status, moved) = common::call(
        &core.app,
        "POST",
        &format!("/v1/me/playlists/{source}/items/transfer"),
        Some(json!({"itemIds": picked_ids, "targetId": target, "mode": "move"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((moved["removed"].as_u64(), moved["skipped"].as_u64()), (Some(2), Some(1)));
    assert_eq!(moved["added"][0]["track"]["id"], "b");
    assert_eq!(track_order(&core, &source).await.0, ["a"]);
    assert_eq!(track_order(&core, &target).await.0, ["c", "b"]);

    let added_ids: Vec<&str> = moved["added"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap()).collect();
    let (status, removed) = common::call(&core.app, "POST", &format!("/v1/me/playlists/{target}/items/remove"), Some(json!({"itemIds": added_ids}))).await;
    assert_eq!((status, removed["removed"].as_u64()), (StatusCode::OK, Some(1)));
    let restore: Vec<Value> = picked.iter().map(|i| json!({"trackId": i["track"]["id"], "position": i["position"], "addedAt": i["addedAt"]})).collect();
    let (status, inserted) = common::call(&core.app, "POST", &format!("/v1/me/playlists/{source}/items/insert"), Some(json!({"items": restore}))).await;
    assert_eq!((status, inserted["added"].as_u64()), (StatusCode::OK, Some(2)));
    assert_eq!(track_order(&core, &source).await.0, ["a", "b", "c"]);
    assert_eq!(track_order(&core, &target).await.0, ["c"]);
}

#[tokio::test]
async fn bulk_bodies_are_validated() {
    let core = common::core();
    let source = playlist_with(&core, "Source", &["a"]).await;
    let base = format!("/v1/me/playlists/{source}/items");
    let (status, _) = common::call(&core.app, "POST", &format!("{base}/transfer"), Some(json!({"itemIds": [], "targetId": source, "mode": "move"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "same playlist");
    let (status, _) = common::call(&core.app, "POST", &format!("{base}/transfer"), Some(json!({"itemIds": [], "targetId": "x", "mode": "clone"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "unknown mode");
    let (status, _) = common::call(&core.app, "POST", &format!("{base}/transfer"), Some(json!({"itemIds": [], "targetId": "missing", "mode": "copy"}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let too_many: Vec<String> = (0..5001).map(|n| n.to_string()).collect();
    assert_eq!(common::call(&core.app, "POST", &format!("{base}/remove"), Some(json!({"itemIds": too_many}))).await.0, StatusCode::BAD_REQUEST);
    let (status, _) = common::call(&core.app, "POST", &format!("{base}/insert"), Some(json!({"items": [{"trackId": "a", "position": 1, "addedAt": 5}]}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "addedAt is an ISO string");
}

#[tokio::test]
async fn large_insert_body_is_accepted_within_limit() {
    let core = common::core();
    let pid = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Big"}))).await.1["id"].as_str().unwrap().to_string();
    let items: Vec<Value> = (0..4000)
        .map(|n| json!({"trackId": format!("t{n}"), "position": n as f64, "addedAt": "2024-01-01T00:00:00.000Z"}))
        .collect();
    let (status, _) = common::call(&core.app, "POST", &format!("/v1/me/playlists/{pid}/items/insert"), Some(json!({"items": items}))).await;
    assert_eq!(status, StatusCode::OK, "4000 items fit in the 1 MB body limit");
}

#[tokio::test]
async fn offline_progress_follows_the_audio_cache() {
    let core = common::core();
    let id = playlist_with(&core, "Offline", &["a", "b"]).await;
    let (status, progress) = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}/offline"), None).await;
    assert_eq!((status, progress), (StatusCode::OK, json!({"cached": 0, "total": 2})));

    let upload = axum::http::Request::put("/v1/cache/audio/a")
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", "audio/webm")
        .body(axum::body::Body::from(vec![1u8; 64]))
        .unwrap();
    assert_eq!(common::send(&core.app, upload).await.0, StatusCode::NO_CONTENT);
    let (_, progress) = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}/offline"), None).await;
    assert_eq!(progress, json!({"cached": 1, "total": 2}));
    assert_eq!(common::call(&core.app, "GET", "/v1/me/playlists/missing/offline", None).await.0, StatusCode::NOT_FOUND);
}
