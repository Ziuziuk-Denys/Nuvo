mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

fn track(id: &str) -> Value {
    json!({"id": id, "title": format!("Song {id}"), "artists": [{"id": "a", "name": "Artist"}], "durationMs": 200000})
}

#[tokio::test]
async fn like_a_whole_album_and_undo() {
    let core = common::core();
    for id in ["t1", "t2", "t3", "t4", "t5"] {
        common::call(&core.app, "PUT", &format!("/v1/me/library/tracks/{id}"), Some(json!({"track": track(id)}))).await;
    }
    let album: Vec<Value> = (1..=40).map(|i| track(&format!("t{i}"))).collect();
    let (status, result) = common::call(&core.app, "POST", "/v1/me/library/tracks/bulk", Some(json!({"tracks": album}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["added"].as_array().unwrap().len(), 35);
    assert_eq!((result["alreadyLiked"].as_u64(), result["rejected"].as_u64()), (Some(5), Some(0)));

    let (status, removed) = common::call(&core.app, "POST", "/v1/me/library/tracks/bulk-remove", Some(json!({"ids": result["added"]}))).await;
    assert_eq!((status, removed), (StatusCode::OK, json!({"removed": 35})));
    let liked = common::call(&core.app, "GET", "/v1/me/library/tracks?limit=100", None).await.1;
    let mut ids: Vec<&str> = liked["items"].as_array().unwrap().iter().map(|i| i["track"]["id"].as_str().unwrap()).collect();
    ids.sort();
    assert_eq!(ids, ["t1", "t2", "t3", "t4", "t5"], "the five liked before stay liked");
}
