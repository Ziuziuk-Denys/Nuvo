mod common;

use axum::http::StatusCode;
use serde_json::json;

fn session() -> serde_json::Value {
    json!({"accessToken": "ya29.a0-AT", "refreshToken": "1//0g-RT", "tokenType": "Bearer", "expiresAt": 1_900_000_000_000_i64, "scope": "http://gdata.youtube.com"})
}

#[tokio::test]
async fn a_fresh_profile_has_no_session_and_the_default_preferences() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "GET", "/v1/youtube/account", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"session": null, "preferences": {"playThroughAccount": true, "offerSignIn": false, "showAccountPlaylists": true}}));
}

#[tokio::test]
async fn a_session_round_trips_and_is_removed() {
    let core = common::core();
    assert_eq!(common::call(&core.app, "PUT", "/v1/youtube/account/session", Some(session())).await.0, StatusCode::NO_CONTENT);
    let (_, body) = common::call(&core.app, "GET", "/v1/youtube/account", None).await;
    assert_eq!(body["session"], session());
    assert_eq!(common::call(&core.app, "DELETE", "/v1/youtube/account/session", None).await.0, StatusCode::NO_CONTENT);
    let (_, body) = common::call(&core.app, "GET", "/v1/youtube/account", None).await;
    assert_eq!(body["session"], json!(null));
}

#[tokio::test]
async fn malformed_sessions_are_refused() {
    let core = common::core();
    for bad in [
        json!({"accessToken": "", "refreshToken": "r", "tokenType": "Bearer", "expiresAt": 1}),
        json!({"accessToken": "a b", "refreshToken": "r", "tokenType": "Bearer", "expiresAt": 1}),
        json!({"accessToken": "a", "refreshToken": "r", "tokenType": "Bearer x", "expiresAt": 1}),
        json!({"accessToken": "a", "refreshToken": "r", "tokenType": "Bearer", "expiresAt": 0}),
        json!({"accessToken": "a"}),
    ] {
        let (status, body) = common::call(&core.app, "PUT", "/v1/youtube/account/session", Some(bad.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(body["code"], "INVALID_INPUT");
    }
}

#[tokio::test]
async fn preferences_patch_only_the_given_fields() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "PATCH", "/v1/youtube/account/preferences", Some(json!({"offerSignIn": true}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"playThroughAccount": true, "offerSignIn": true, "showAccountPlaylists": true}));
    let (_, body) = common::call(&core.app, "PATCH", "/v1/youtube/account/preferences", Some(json!({"showAccountPlaylists": false}))).await;
    assert_eq!(body, json!({"playThroughAccount": true, "offerSignIn": true, "showAccountPlaylists": false}));
}
