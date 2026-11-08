mod common;

use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use serde_json::{json, Map, Value};

#[tokio::test]
async fn bindings_round_trip_and_bad_input_is_refused() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "GET", "/v1/shortcuts", None).await;
    assert_eq!((status, body), (StatusCode::OK, json!({"bindings": null})));

    let stored = json!({
        "version": 1,
        "app": {"player.toggle": "P", "player.mute": null, "future.thing": "Control+\\"},
        "global": {"library.like-toggle": "Alt+Shift+J"}
    });
    assert_eq!(common::call(&core.app, "PUT", "/v1/shortcuts", Some(stored.clone())).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/shortcuts", None).await.1, json!({"bindings": stored}));

    let many: Map<String, Value> = (0..257).map(|n| (format!("cmd.{n}"), json!("F1"))).collect();
    for bad in [
        json!({"version": 2, "app": {}, "global": {}}),
        json!({"version": 1, "app": {"Bad Id": "P"}, "global": {}}),
        json!({"version": 1, "app": {"player.toggle": "Control+K Control+J"}, "global": {}}),
        json!({"version": 1, "app": {"player.toggle": ""}, "global": {}}),
        json!({"version": 1, "app": {}}),
        json!({"version": 1, "app": {}, "global": {}, "extra": true}),
        json!({"version": 1, "app": many, "global": {}}),
    ] {
        let (status, error) = common::call(&core.app, "PUT", "/v1/shortcuts", Some(bad)).await;
        assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
    }
    assert_eq!(common::call(&core.app, "GET", "/v1/shortcuts", None).await.1, json!({"bindings": stored}));
}

#[tokio::test]
async fn a_locked_library_answers_423() {
    let first = common::core();
    let locked = common::boot(first.dir, MemoryKeyStore::default(), "http://127.0.0.1:9");
    let (status, error) = common::call(&locked.app, "GET", "/v1/shortcuts", None).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::LOCKED, Some("LOCKED")));
}
