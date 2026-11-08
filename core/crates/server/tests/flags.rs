mod common;

use axum::http::StatusCode;
use serde_json::json;

#[tokio::test]
async fn pin_reorder_hide_over_http() {
    let core = common::core();
    for id in ["a", "b", "c"] {
        let (status, flag) = common::call(&core.app, "PUT", &format!("/v1/me/flags/album/{id}"), Some(json!({"pinned": true, "snapshot": {"title": id}}))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!((flag["pinned"].as_bool(), flag["hidden"].as_bool()), (Some(true), Some(false)));
    }
    let (status, list) = common::call(&core.app, "POST", "/v1/me/flags/pin-order", Some(json!({"items": [{"kind": "album", "id": "c"}]}))).await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<&str> = list["items"].as_array().unwrap().iter().map(|f| f["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["c", "a", "b"]);

    let (_, hidden) = common::call(&core.app, "PUT", "/v1/me/flags/album/a", Some(json!({"hidden": true}))).await;
    assert_eq!((hidden["pinned"].as_bool(), hidden["hidden"].as_bool()), (Some(false), Some(true)));
    assert_eq!(hidden["snapshot"], json!({"title": "a"}));

    let (status, error) = common::call(&core.app, "PUT", "/v1/me/flags/album/a", Some(json!({"starred": true}))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
    assert_eq!(common::call(&core.app, "DELETE", "/v1/me/flags/album/b", None).await.0, StatusCode::NO_CONTENT);
    let list = common::call(&core.app, "GET", "/v1/me/flags", None).await.1;
    let rows: Vec<(String, bool)> = list["items"].as_array().unwrap().iter().map(|f| (f["id"].as_str().unwrap().into(), f["pinned"].as_bool().unwrap())).collect();
    assert_eq!(rows, [("c".to_string(), true), ("a".to_string(), false)]);
}
