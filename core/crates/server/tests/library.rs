mod common;

use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use serde_json::{Value, json};

fn track(id: &str) -> Value {
    json!({"id": id, "title": "Song", "artists": [{"id": "a", "name": "Artist"}], "durationMs": 1000})
}

#[tokio::test]
async fn profile_is_local_and_display_name_is_editable() {
    let core = common::core();
    assert_eq!(common::call(&core.app, "GET", "/v1/me", None).await.1, json!({"id": "local", "username": "me", "displayName": "Me"}));
    let (status, body) = common::call(&core.app, "PATCH", "/v1/users/me", Some(json!({"displayName": "  Denys "}))).await;
    assert_eq!((status, body["displayName"].as_str()), (StatusCode::OK, Some("Denys")));
    let (_, body) = common::call(&core.app, "PATCH", "/v1/users/me", Some(json!({"displayName": null}))).await;
    assert_eq!(body["displayName"], "Me");
    let (status, _) = common::call(&core.app, "PATCH", "/v1/users/me", Some(json!({"displayName": "x".repeat(101)}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn like_list_unlike() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "PUT", "/v1/me/library/tracks/t1", Some(json!({"track": track("t1"), "trackSnapshot": track("t1")}))).await;
    assert_eq!((status, body), (StatusCode::NO_CONTENT, Value::Null), "empty responses must be 204: the renderer JSON-parses anything else");
    let (status, page) = common::call(&core.app, "GET", "/v1/me/library/tracks?limit=100", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["items"][0]["track"]["viewer"]["liked"], true);
    assert!(page["nextCursor"].is_null());
    assert_eq!(common::call(&core.app, "DELETE", "/v1/me/library/tracks/t1", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/me/library/tracks", None).await.1["items"], json!([]));
}

#[tokio::test]
async fn like_without_a_body_for_an_unknown_track_is_404() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "PUT", "/v1/me/library/tracks/ghost", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::NOT_FOUND, Some("NOT_FOUND")));
}

#[tokio::test]
async fn malformed_json_is_invalid_input() {
    let core = common::core();
    let req = axum::http::Request::put("/v1/me/library/tracks/t1")
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .body(axum::body::Body::from("{not json"))
        .unwrap();
    let (status, body, _) = common::send(&core.app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(serde_json::from_slice::<Value>(&body).unwrap()["code"], "INVALID_INPUT");
}

#[tokio::test]
async fn saved_collections_round_trip_in_the_renderer_shape() {
    let core = common::core();
    let snapshot = json!({"snapshot": {"title": "Album", "cover": {"url": "u"}, "trackCount": 10}});
    assert_eq!(common::call(&core.app, "PUT", "/v1/me/library/albums/MPRE1", Some(snapshot)).await.0, StatusCode::NO_CONTENT);
    let (_, body) = common::call(&core.app, "GET", "/v1/me/library/albums", None).await;
    assert_eq!(body["items"][0]["album"]["title"], "Album");
    assert!(body["items"][0]["savedAt"].is_string());
    assert_eq!(common::call(&core.app, "DELETE", "/v1/me/library/albums/MPRE1", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/me/library/songs", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn library_routes_answer_423_while_locked() {
    let first = common::core();
    let core = common::boot(first.dir, MemoryKeyStore::default(), "http://127.0.0.1:9");
    let (status, body) = common::call(&core.app, "GET", "/v1/me/library/tracks", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::LOCKED, Some("LOCKED")));
}

#[tokio::test]
async fn a_single_and_its_album_copy_are_liked_once_a_live_cut_stays_apart() {
    let core = common::core();
    let track = |id: &str, title: &str, ms: i64| { let t = json!({"id": id, "title": title, "artists": [{"id": "a", "name": "Nova"}], "durationMs": ms}); json!({"track": t, "trackSnapshot": t}) };
    for (id, title, ms) in [("single00001", "Skyline", 200_000), ("albumcopy01", "Skyline (Album Version)", 201_000), ("livecut0001", "Skyline (Live)", 200_000)] {
        let (status, _) = common::call(&core.app, "PUT", &format!("/v1/me/library/tracks/{id}"), Some(track(id, title, ms))).await;
        assert_eq!(status, 204, "{id}");
    }
    let (_, page) = common::call(&core.app, "GET", "/v1/me/library/tracks", None).await;
    let ids: Vec<&str> = page["items"].as_array().unwrap().iter().map(|item| item["track"]["id"].as_str().unwrap_or_default()).collect();
    assert_eq!(ids.len(), 2, "{page}");
    assert!(!ids.contains(&"single00001"), "{page}");
}

#[tokio::test]
async fn a_bulk_like_keeps_one_copy_of_a_song_and_counts_the_twin_as_already_liked() {
    let core = common::core();
    let make = |id: &str, title: &str, ms: i64| json!({"id": id, "title": title, "artists": [{"id": "a", "name": "Nova"}], "durationMs": ms});
    let single = make("single00001", "Skyline", 200_000);
    let (status, _) = common::call(&core.app, "PUT", "/v1/me/library/tracks/single00001", Some(json!({"track": single, "trackSnapshot": single}))).await;
    assert_eq!(status, 204);
    let batch = json!({"tracks": [make("albumcopy01", "Skyline (Album Version)", 201_000), make("livecut0001", "Skyline (Live)", 200_000), make("other000001", "Harbour", 180_000), make("other000002", "Harbour", 180_500)]});
    let (status, result) = common::call(&core.app, "POST", "/v1/me/library/tracks/bulk", Some(batch)).await;
    assert_eq!(status, 200, "{result}");
    assert_eq!((result["added"].as_array().map(Vec::len), result["alreadyLiked"].as_i64()), (Some(2), Some(2)), "{result}");
    let (_, page) = common::call(&core.app, "GET", "/v1/me/library/tracks", None).await;
    assert_eq!(page["items"].as_array().unwrap().len(), 3, "{page}");
}
