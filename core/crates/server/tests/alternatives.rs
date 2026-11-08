mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use nuvo_crypto::MemoryKeyStore;
use serde_json::{Value, json};

fn alt() -> Value {
    json!({"source": "soundcloud", "altId": "sc:9", "score": 91, "reason": "unavailable", "durationMs": 201000})
}

#[tokio::test]
async fn an_alternative_is_stored_replaced_and_rejected() {
    let core = common::core();
    let path = "/v1/tracks/y1/alternative";
    assert_eq!(common::call(&core.app, "GET", path, None).await.0, StatusCode::NO_CONTENT);

    assert_eq!(common::call(&core.app, "PUT", path, Some(alt())).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", path, None).await, (StatusCode::OK, alt()));

    let without_duration = json!({"source": "youtube", "altId": "v2", "score": 80, "reason": "timeout"});
    common::call(&core.app, "PUT", path, Some(without_duration.clone())).await;
    assert_eq!(common::call(&core.app, "GET", path, None).await.1, without_duration, "durationMs is optional and omitted");

    let stale = common::call(&core.app, "POST", &format!("{path}/reject"), Some(json!({"altId": "other"}))).await;
    assert_eq!(stale.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", path, None).await.0, StatusCode::OK, "another id leaves the stored choice");
    assert_eq!(common::call(&core.app, "POST", &format!("{path}/reject"), Some(json!({"altId": "v2"}))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", path, None).await.0, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn bad_input_is_refused() {
    let core = common::core();
    let path = "/v1/tracks/y1/alternative";
    let with = |field: &str, value: Value| {
        let mut body = alt();
        body[field] = value;
        body
    };
    for body in [
        with("source", json!("spotify")),
        with("altId", json!("")),
        with("altId", json!("x".repeat(257))),
        with("score", json!(101)),
        with("score", json!(-1)),
        with("reason", json!(" ")),
        json!({"source": "youtube"}),
    ] {
        let (status, error) = common::call(&core.app, "PUT", path, Some(body.clone())).await;
        assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{body}");
    }
    assert_eq!(common::call(&core.app, "PUT", &format!("/v1/tracks/{}/alternative", "t".repeat(257)), Some(alt())).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::call(&core.app, "GET", &format!("/v1/tracks/{}/alternative", "t".repeat(257)), None).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::call(&core.app, "POST", &format!("{path}/reject"), Some(json!({"altId": ""}))).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::call(&core.app, "GET", path, None).await.0, StatusCode::NO_CONTENT, "nothing was stored");
    let nonsense = with("durationMs", json!(-5));
    common::call(&core.app, "PUT", path, Some(nonsense)).await;
    assert!(common::call(&core.app, "GET", path, None).await.1.get("durationMs").is_none(), "a non-positive duration is dropped");
}

#[tokio::test]
async fn rejecting_also_drops_the_matching_stand_in() {
    let core = common::core();
    let src = json!({"title": "Night Drive", "artists": ["dj"], "durationMs": 200000});
    let steps = json!([{"query": "dj Night Drive", "filter": "songs", "failed": false, "found": 1}]);
    let candidate = json!({"id": "dQw4w9WgXcQ", "title": "Night Drive", "artists": [{"id": "a", "name": "dj"}], "durationMs": 200000});
    let body = json!({"source": src, "candidates": [candidate], "steps": steps, "standInFor": "sc:5"});
    assert_eq!(common::call(&core.app, "POST", "/v1/match/next", Some(body)).await.1["status"], "approved");

    let other = json!({"title": "Renamed upload", "artists": [], "durationMs": 1});
    let ask = json!({"source": other, "standInFor": "sc:5"});
    assert_eq!(common::call(&core.app, "POST", "/v1/match/next", Some(ask.clone())).await.1["status"], "approved");
    let stored = json!({"source": "youtube", "altId": "dQw4w9WgXcQ", "score": 100, "reason": "unavailable"});
    common::call(&core.app, "PUT", "/v1/tracks/sc:5/alternative", Some(stored)).await;
    common::call(&core.app, "POST", "/v1/tracks/sc:5/alternative/reject", Some(json!({"altId": "dQw4w9WgXcQ"}))).await;
    assert_eq!(common::call(&core.app, "POST", "/v1/match/next", Some(ask)).await.1["status"], "search");
    let again = common::call(&core.app, "POST", "/v1/match/next", Some(json!({"source": src}))).await.1;
    assert_eq!(again["status"], "search", "the remembered outcome that proposed it is gone too");
}

#[tokio::test]
async fn a_locked_library_remembers_nothing_and_does_not_fail() {
    let first = common::core();
    let locked = common::boot(first.dir, MemoryKeyStore::with_key([9u8; 32]), "http://127.0.0.1:9");
    assert!(locked.state.is_locked());
    let path = "/v1/tracks/y1/alternative";
    assert_eq!(common::call(&locked.app, "GET", path, None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&locked.app, "PUT", path, Some(alt())).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&locked.app, "POST", &format!("{path}/reject"), Some(json!({"altId": "sc:9"}))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&locked.app, "PUT", path, Some(json!({"source": "x"}))).await.0, StatusCode::BAD_REQUEST, "input is still validated");
}

#[tokio::test]
async fn the_routes_require_the_token() {
    let core = common::core();
    for (method, uri) in [("GET", "/v1/tracks/y1/alternative"), ("PUT", "/v1/tracks/y1/alternative"), ("POST", "/v1/tracks/y1/alternative/reject")] {
        let req = Request::builder().method(method).uri(uri).header("content-type", "application/json").body(Body::from("{}")).unwrap();
        assert_eq!(common::send(&core.app, req).await.0, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

#[tokio::test]
async fn writes_are_refused_with_starting_instead_of_dropped_while_the_core_starts() {
    let (_dir, app) = common::starting();
    let path = "/v1/tracks/y1/alternative";
    assert_eq!(common::call(&app, "PUT", path, Some(alt())).await.0, StatusCode::SERVICE_UNAVAILABLE);
    let reject = common::call(&app, "POST", &format!("{path}/reject"), Some(json!({"altId": "sc:9"}))).await;
    assert_eq!(reject.0, StatusCode::SERVICE_UNAVAILABLE);
}
