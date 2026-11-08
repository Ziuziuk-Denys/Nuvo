mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

#[tokio::test]
async fn items_page_and_detail_head_over_http() {
    let core = common::core();
    let id = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": "Big"}))).await.1["id"].as_str().unwrap().to_string();
    let tracks: Vec<Value> = (0..25).map(|i| json!({"id": format!("t{i}"), "title": format!("Song {i}"), "artists": [{"id": "a", "name": "Artist"}], "durationMs": 1000})).collect();
    common::call(&core.app, "POST", &format!("/v1/me/playlists/{id}/tracks"), Some(json!({"tracks": tracks}))).await;

    let (status, head) = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}?limit=10"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((head["items"].as_array().unwrap().len(), head["total"].as_u64()), (10, Some(25)));
    let cursor = head["nextCursor"].as_str().unwrap().to_string();
    let full = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}"), None).await.1;
    assert_eq!(full["items"].as_array().unwrap().len(), 25);
    assert!(full.get("total").is_none());

    let (status, page) = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}/items?cursor={cursor}&limit=10"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["items"][0]["track"]["id"], "t10");
    let last = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}/items?cursor={}&limit=10", page["nextCursor"].as_str().unwrap()), None).await.1;
    assert_eq!(last["items"].as_array().unwrap().len(), 5);
    assert!(last.get("nextCursor").is_none());

    let filtered = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}/items?q=song%202"), None).await.1;
    assert_eq!(filtered["total"], 6, "Song 2 and Song 20 to 24");
    let (status, error) = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}/items?cursor=gone"), None).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::CONFLICT, Some("CONFLICT")));
    assert_eq!(common::call(&core.app, "GET", "/v1/me/playlists/nope/items", None).await.0, StatusCode::NOT_FOUND);
}
