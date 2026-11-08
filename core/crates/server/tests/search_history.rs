mod common;

use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use serde_json::json;

#[tokio::test]
async fn search_history_over_http() {
    let core = common::core();
    let base = "/v1/me/search-history";
    let (status, entry) = common::call(&core.app, "POST", base, Some(json!({"kind": "query", "query": "Daft Punk"}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((entry["kind"].as_str(), entry["query"].as_str()), (Some("query"), Some("Daft Punk")));
    assert!(entry["at"].as_str().unwrap().ends_with('Z'));
    let item = json!({"id": "t1", "title": "One More Time", "subtitle": "Daft Punk", "coverUrl": "https://img/t1.jpg"});
    let (_, picked) = common::call(&core.app, "POST", base, Some(json!({"kind": "track", "query": "daft", "item": item}))).await;

    let (status, list) = common::call(&core.app, "GET", &format!("{base}?limit=30"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 2);
    assert_eq!(list["items"][0]["item"], item);

    let (status, error) = common::call(&core.app, "POST", base, Some(json!({"kind": "query"}))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));

    let id = picked["id"].as_str().unwrap();
    assert_eq!(common::call(&core.app, "DELETE", &format!("{base}/{id}"), None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", base, None).await.1["items"].as_array().unwrap().len(), 1);
    assert_eq!(common::call(&core.app, "DELETE", base, None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", base, None).await.1, json!({"items": []}));
}

#[tokio::test]
async fn a_locked_library_answers_423() {
    let first = common::core();
    let locked = common::boot(first.dir, MemoryKeyStore::default(), "http://127.0.0.1:9");
    let (status, error) = common::call(&locked.app, "GET", "/v1/me/search-history", None).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::LOCKED, Some("LOCKED")));
}
