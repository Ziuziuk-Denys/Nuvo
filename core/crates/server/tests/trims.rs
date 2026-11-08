mod common;

use axum::http::StatusCode;
use serde_json::json;

#[tokio::test]
async fn trim_lifecycle_over_http() {
    let core = common::core();
    let track = json!({"id": "t1", "title": "Song", "artists": [{"id": "a", "name": "Artist"}], "durationMs": 180000});
    let (status, trim) = common::call(&core.app, "PUT", "/v1/tracks/t1/trim", Some(json!({"startMs": 30000.4, "endMs": 90000, "track": track}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(trim, json!({"trackId": "t1", "startMs": 30000, "endMs": 90000}));

    assert_eq!(common::call(&core.app, "GET", "/v1/tracks/t1/trim", None).await.1, trim);
    assert_eq!(common::call(&core.app, "GET", "/v1/me/trims", None).await.1, json!({"items": [trim]}));

    let (status, body) = common::call(&core.app, "PUT", "/v1/tracks/t1/trim", Some(json!({"startMs": 0, "endMs": 4000}))).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
    let (status, _) = common::call(&core.app, "PUT", "/v1/tracks/t1/trim", Some(json!({"startMs": 0, "endMs": 180001}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = common::call(&core.app, "PUT", "/v1/tracks/nope/trim", Some(json!({"startMs": 0, "endMs": 10000}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    assert_eq!(common::call(&core.app, "DELETE", "/v1/tracks/t1/trim", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/tracks/t1/trim", None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "GET", "/v1/me/trims", None).await.1, json!({"items": []}));
}
