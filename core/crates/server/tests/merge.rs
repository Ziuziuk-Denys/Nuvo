mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

async fn playlist(core: &common::TestCore, title: &str, ids: &[&str]) -> String {
    let id = common::call(&core.app, "POST", "/v1/me/playlists", Some(json!({"title": title}))).await.1["id"].as_str().unwrap().to_string();
    let tracks: Vec<Value> = ids.iter().map(|t| json!({"id": t, "title": t, "artists": [{"id": "a", "name": "A"}], "durationMs": 1000})).collect();
    common::call(&core.app, "POST", &format!("/v1/me/playlists/{id}/tracks"), Some(json!({"tracks": tracks}))).await;
    id
}

async fn ids(core: &common::TestCore, id: &str) -> Vec<String> {
    let detail = common::call(&core.app, "GET", &format!("/v1/me/playlists/{id}"), None).await.1;
    detail["items"].as_array().unwrap().iter().map(|i| i["track"]["id"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn merge_two_imports_and_undo() {
    let core = common::core();
    let a = playlist(&core, "A", &["t1", "t2", "t3"]).await;
    let b = playlist(&core, "B", &["t3", "t4"]).await;
    let target = playlist(&core, "A + B", &[]).await;
    let (status, result) = common::call(&core.app, "POST", &format!("/v1/me/playlists/{target}/merge"), Some(json!({"sourceIds": [a, b], "deleteSources": true}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((result["added"].as_u64(), result["skipped"].as_u64()), (Some(4), Some(1)));
    assert_eq!(ids(&core, &target).await, ["t1", "t2", "t3", "t4"]);
    assert_eq!(common::call(&core.app, "GET", &format!("/v1/me/playlists/{a}"), None).await.0, StatusCode::NOT_FOUND);

    let removed = common::call(&core.app, "POST", &format!("/v1/me/playlists/{target}/items/remove"), Some(json!({"itemIds": result["addedItemIds"]}))).await.1;
    assert_eq!(removed["removed"], 4);
    let (status, restored) = common::call(&core.app, "POST", "/v1/me/playlists/restore", Some(json!({"snapshots": result["snapshots"]}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(restored["items"].as_array().unwrap().len(), 2);
    assert_eq!(ids(&core, &a).await, ["t1", "t2", "t3"]);
    assert_eq!(ids(&core, &b).await, ["t3", "t4"]);
    assert!(ids(&core, &target).await.is_empty());

    let (status, error) = common::call(&core.app, "POST", &format!("/v1/me/playlists/{a}/merge"), Some(json!({"sourceIds": [a]}))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
}
