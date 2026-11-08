mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use axum::routing::post;
use axum::{Form, Json, Router};
use nuvo_contracts::RecordPlaybackEvent;
use nuvo_crypto::MemoryKeyStore;
use nuvo_lastfm::sign;
use nuvo_server::scrobbler;
use nuvo_lastfm::LastfmError;
use nuvo_store::{events, settings};
use serde_json::{Value, json};

const SECRET: &str = "s3cret";
const NOW: i64 = 1_700_000_000_000;

type Calls = Arc<Mutex<Vec<Vec<(String, String)>>>>;

/// Mock Last.fm. Checks signatures, records every call, answers `track.scrobble` with error 16
/// while `failures` is above zero and with error 9 for the session key "revoked".
async fn mock() -> (String, Calls, Arc<AtomicUsize>) {
    let calls: Calls = Arc::default();
    let failures = Arc::new(AtomicUsize::new(0));
    let (seen, failing) = (calls.clone(), failures.clone());
    let app = Router::new().route(
        "/2.0/",
        post(move |Form(params): Form<Vec<(String, String)>>| {
            let (seen, failing) = (seen.clone(), failing.clone());
            async move {
                let get = |name: &str| params.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()).unwrap_or_default();
                let unsigned: Vec<_> = params.iter().filter(|(k, _)| k != "api_sig").cloned().collect();
                seen.lock().unwrap().push(params.clone());
                if sign(&unsigned, SECRET) != get("api_sig") {
                    return (StatusCode::FORBIDDEN, Json(json!({"error": 13, "message": "Invalid method signature supplied"})));
                }
                match get("method").as_str() {
                    "auth.getToken" if failing.load(Ordering::SeqCst) > 0 => {
                        failing.fetch_sub(1, Ordering::SeqCst);
                        (StatusCode::TOO_MANY_REQUESTS, Json(json!({"error": 29, "message": "Rate limit exceeded"})))
                    }
                    "auth.getToken" => (StatusCode::OK, Json(json!({"token": "tok123"}))),
                    "auth.getSession" if get("token") == "tok123" => (StatusCode::OK, Json(json!({"session": {"name": "owner", "key": "sk1"}}))),
                    "auth.getSession" => (StatusCode::FORBIDDEN, Json(json!({"error": 14, "message": "Unauthorized Token"}))),
                    _ if get("sk") == "badkey" => (StatusCode::FORBIDDEN, Json(json!({"error": 10, "message": "Invalid API key"}))),
                    _ if get("sk") == "revoked" => (StatusCode::FORBIDDEN, Json(json!({"error": 9, "message": "Invalid session key"}))),
                    "track.scrobble" if failing.load(Ordering::SeqCst) > 0 => {
                        failing.fetch_sub(1, Ordering::SeqCst);
                        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": 16, "message": "Service temporarily unavailable"})))
                    }
                    "track.scrobble" | "track.updateNowPlaying" => (StatusCode::OK, Json(json!({}))),
                    _ => (StatusCode::BAD_REQUEST, Json(json!({"error": 3, "message": "Invalid Method"}))),
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/2.0/"), calls, failures)
}

async fn core_with_mock() -> (common::TestCore, Calls, Arc<AtomicUsize>) {
    let (url, calls, failures) = mock().await;
    let core = common::boot_lastfm(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), "http://127.0.0.1:9", &url);
    (core, calls, failures)
}

async fn connect(core: &common::TestCore) {
    common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key1", "apiSecret": SECRET}))).await;
    let (status, body) = common::call(&core.app, "POST", "/v1/lastfm/auth/session", Some(json!({"token": "tok123"}))).await;
    assert_eq!((status, body["connected"].as_bool()), (StatusCode::OK, Some(true)));
}

/// Stores a session directly. Connecting over HTTP starts a background flush, which would race
/// the explicit `flush` calls these tests make.
async fn connect_quietly(core: &common::TestCore, session_key: &'static str) {
    let db = core.state.data().unwrap().db;
    db.call(move |c| {
        settings::set(c, settings::LASTFM_API_KEY, &json!("key1"))?;
        settings::set(c, settings::LASTFM_API_SECRET, &json!(SECRET))?;
        settings::set(c, settings::LASTFM_SESSION_KEY, &json!(session_key))
    })
    .await
    .unwrap();
}

fn methods(calls: &Calls, method: &str) -> Vec<Vec<(String, String)>> {
    calls.lock().unwrap().iter().filter(|c| c.iter().any(|(k, v)| k == "method" && v == method)).cloned().collect()
}

/// Records a qualifying play straight through the store, so no background flush races the test.
async fn record_plays(core: &common::TestCore, count: i64) {
    let db = core.state.data().unwrap().db;
    db.call(move |c| {
        for n in 0..count {
            let event: RecordPlaybackEvent = serde_json::from_value(json!({
                "listeningSessionId": "s", "trackId": format!("t{n}"), "playedDurationMs": 200000, "trackDurationMs": 200000,
                "completed": true, "startedAt": NOW + n * 1000,
                "trackSnapshot": {"id": format!("t{n}"), "title": format!("Song {n}"), "artists": [{"id": "a", "name": "Artist"}], "durationMs": 200000}
            }))
            .unwrap();
            assert!(events::record(c, &event, NOW)?.queued);
        }
        Ok(())
    })
    .await
    .unwrap();
}

async fn status(core: &common::TestCore) -> Value {
    common::call(&core.app, "GET", "/v1/lastfm/status", None).await.1
}

#[tokio::test]
async fn connect_with_the_desktop_auth_flow() {
    let (core, _, _) = core_with_mock().await;
    assert_eq!(
        status(&core).await,
        json!({"hasCredentials": false, "connected": false, "user": null, "enabled": true, "queued": 0, "lastError": null})
    );
    let (status_code, _) = common::call(&core.app, "POST", "/v1/lastfm/auth/token", None).await;
    assert_eq!(status_code, StatusCode::BAD_REQUEST, "no credentials yet");
    let (status_code, _) = common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "has space"}))).await;
    assert_eq!(status_code, StatusCode::BAD_REQUEST);

    let (_, saved) = common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key1", "apiSecret": SECRET}))).await;
    assert_eq!((saved["hasCredentials"].as_bool(), saved["connected"].as_bool()), (Some(true), Some(false)));
    let (status_code, token) = common::call(&core.app, "POST", "/v1/lastfm/auth/token", None).await;
    assert_eq!(status_code, StatusCode::OK);
    assert_eq!(token, json!({"token": "tok123", "authUrl": "https://www.last.fm/api/auth/?api_key=key1&token=tok123"}));

    let (status_code, body) = common::call(&core.app, "POST", "/v1/lastfm/auth/session", Some(json!({"token": "notyet"}))).await;
    assert_eq!((status_code, body["code"].as_str()), (StatusCode::CONFLICT, Some("CONFLICT")), "user has not approved yet");
    let (status_code, connected) = common::call(&core.app, "POST", "/v1/lastfm/auth/session", Some(json!({"token": "tok123"}))).await;
    assert_eq!(status_code, StatusCode::OK);
    assert_eq!((connected["connected"].as_bool(), connected["user"].as_str()), (Some(true), Some("owner")));

    let (_, same) = common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key1", "enabled": false}))).await;
    assert_eq!((same["connected"].as_bool(), same["enabled"].as_bool()), (Some(true), Some(false)), "saving the same key keeps the session");
    let (_, changed) = common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key2"}))).await;
    assert_eq!(changed["connected"].as_bool(), Some(false), "a new key needs a new session");

    connect(&core).await;
    let (status_code, gone) = common::call(&core.app, "DELETE", "/v1/lastfm/session", None).await;
    assert_eq!((status_code, gone["connected"].as_bool(), gone["hasCredentials"].as_bool()), (StatusCode::OK, Some(false), Some(true)));
}

#[tokio::test]
async fn the_secret_never_leaves_the_daemon() {
    let (core, _, _) = core_with_mock().await;
    connect(&core).await;
    let body = status(&core).await.to_string();
    assert!(!body.contains(SECRET) && !body.contains("sk1"), "{body}");
}

#[tokio::test]
async fn unreachable_lastfm_is_a_bad_gateway() {
    let core = common::core();
    common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key1", "apiSecret": SECRET}))).await;
    let (status_code, body) = common::call(&core.app, "POST", "/v1/lastfm/auth/token", None).await;
    assert_eq!((status_code, body["code"].as_str()), (StatusCode::BAD_GATEWAY, Some("UPSTREAM")));
}

#[tokio::test]
async fn scrobbles_go_out_in_batches_of_fifty() {
    let (core, calls, _) = core_with_mock().await;
    connect_quietly(&core, "sk1").await;
    record_plays(&core, 120).await;
    assert_eq!(status(&core).await["queued"], 120);

    assert_eq!(scrobbler::flush(&core.state, NOW).await.unwrap(), 120);
    let sizes: Vec<usize> = methods(&calls, "track.scrobble").iter().map(|c| c.iter().filter(|(k, _)| k.starts_with("artist[")).count()).collect();
    assert_eq!(sizes, [50, 50, 20]);
    let first = &methods(&calls, "track.scrobble")[0];
    assert!(first.contains(&("timestamp[0]".into(), (NOW / 1000).to_string())) && first.contains(&("sk".into(), "sk1".into())));
    assert_eq!(status(&core).await["queued"], 0);
}

#[tokio::test]
async fn failed_scrobbles_stay_queued_and_retry_after_backoff() {
    let (core, calls, failures) = core_with_mock().await;
    connect_quietly(&core, "sk1").await;
    record_plays(&core, 3).await;
    failures.store(1, Ordering::SeqCst);

    assert_eq!(scrobbler::flush(&core.state, NOW).await.unwrap(), 0);
    let after_failure = status(&core).await;
    assert_eq!(after_failure["queued"], 3);
    assert!(after_failure["lastError"].as_str().unwrap().contains("16"));

    assert_eq!(scrobbler::flush(&core.state, NOW + 1000).await.unwrap(), 0, "still backing off");
    assert_eq!(methods(&calls, "track.scrobble").len(), 1);
    assert_eq!(scrobbler::flush(&core.state, NOW + 60_000).await.unwrap(), 3);
    let recovered = status(&core).await;
    assert_eq!((recovered["queued"].as_i64(), recovered["lastError"].is_null()), (Some(0), true));
}

#[tokio::test]
async fn a_revoked_session_disconnects_and_keeps_the_queue() {
    let (core, _, _) = core_with_mock().await;
    connect_quietly(&core, "revoked").await;
    record_plays(&core, 2).await;

    assert_eq!(scrobbler::flush(&core.state, NOW).await.unwrap(), 0);
    let after = status(&core).await;
    assert_eq!((after["connected"].as_bool(), after["queued"].as_i64()), (Some(false), Some(2)));
    assert!(after["lastError"].as_str().unwrap().contains("Invalid session key"));

    connect_quietly(&core, "sk1").await;
    assert_eq!(scrobbler::flush(&core.state, NOW + 60_000).await.unwrap(), 2, "reconnecting sends what waited");
}

#[tokio::test]
async fn recorded_plays_and_now_playing_reach_lastfm() {
    let (core, calls, _) = core_with_mock().await;
    let snapshot = json!({"id": "np", "title": "Now", "artists": [{"id": "a", "name": "Artist"}], "album": {"id": "al", "title": "LP"}, "durationMs": 180000});
    let body = json!({"trackId": "np", "trackSnapshot": snapshot});
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/now-playing", Some(body.clone())).await.0, StatusCode::NO_CONTENT);
    assert!(calls.lock().unwrap().is_empty(), "nothing is sent while disconnected");

    connect(&core).await;
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/now-playing", Some(body)).await.0, StatusCode::NO_CONTENT);
    let now_playing = methods(&calls, "track.updateNowPlaying");
    assert_eq!(now_playing.len(), 1);
    for (k, v) in [("artist", "Artist"), ("track", "Now"), ("album", "LP"), ("duration", "180")] {
        assert!(now_playing[0].contains(&(k.to_string(), v.to_string())), "{k}");
    }

    let event = json!({"listeningSessionId": "s", "trackId": "np", "playedDurationMs": 180000, "trackDurationMs": 180000, "completed": true});
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event)).await.0, StatusCode::NO_CONTENT);
    // The route already started a background flush; this one waits for it and then finds nothing left.
    scrobbler::flush(&core.state, nuvo_store::now_ms()).await.unwrap();
    assert_eq!(methods(&calls, "track.scrobble").len(), 1);
    assert_eq!(status(&core).await["queued"], 0);
}

#[tokio::test]
async fn disconnecting_clears_the_queue() {
    let (core, _, _) = core_with_mock().await;
    connect_quietly(&core, "sk1").await;
    record_plays(&core, 2).await;
    let (_, gone) = common::call(&core.app, "DELETE", "/v1/lastfm/session", None).await;
    assert_eq!(gone["queued"], 0);
}

#[tokio::test]
async fn changing_the_key_clears_session_and_queue() {
    let (core, _, _) = core_with_mock().await;
    connect_quietly(&core, "sk1").await;
    record_plays(&core, 2).await;
    let (_, same) = common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key1"}))).await;
    assert_eq!((same["connected"].as_bool(), same["queued"].as_i64()), (Some(true), Some(2)), "same key changes nothing");
    let (_, changed) = common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key2"}))).await;
    assert_eq!((changed["connected"].as_bool(), changed["queued"].as_i64()), (Some(false), Some(0)));
}

#[tokio::test]
async fn a_failure_only_clears_the_session_that_failed() {
    let (core, _, _) = core_with_mock().await;
    connect_quietly(&core, "new").await;
    let data = core.state.data().unwrap();
    let revoked = LastfmError::Api { code: 9, message: "Invalid session key".into() };
    scrobbler::note_failure(&data, "old", &revoked).await.unwrap();
    let kept = status(&core).await;
    assert_eq!(kept["connected"], true, "a reconnect must survive a stale failure");
    assert!(kept["lastError"].as_str().unwrap().contains("Invalid session key"));
    scrobbler::note_failure(&data, "new", &revoked).await.unwrap();
    assert_eq!(status(&core).await["connected"], false);
}

#[tokio::test]
async fn retryable_errors_on_the_auth_routes_are_a_bad_gateway() {
    let (core, _, failures) = core_with_mock().await;
    common::call(&core.app, "PATCH", "/v1/lastfm/settings", Some(json!({"apiKey": "key1", "apiSecret": SECRET}))).await;
    failures.store(1, Ordering::SeqCst);
    let (code, body) = common::call(&core.app, "POST", "/v1/lastfm/auth/token", None).await;
    assert_eq!((code, body["code"].as_str()), (StatusCode::BAD_GATEWAY, Some("UPSTREAM")), "error 29");
}

#[tokio::test]
async fn refused_credentials_clear_the_session_keep_the_queue_and_stop_retrying() {
    let (core, calls, _) = core_with_mock().await;
    connect_quietly(&core, "badkey").await;
    record_plays(&core, 2).await;
    assert_eq!(scrobbler::flush(&core.state, NOW).await.unwrap(), 0);
    let after = status(&core).await;
    assert_eq!((after["connected"].as_bool(), after["queued"].as_i64()), (Some(false), Some(2)));
    assert!(after["lastError"].as_str().unwrap().contains("10"));
    assert_eq!(scrobbler::flush(&core.state, NOW + 3_600_000).await.unwrap(), 0);
    assert_eq!(methods(&calls, "track.scrobble").len(), 1, "no retry without a session");
}
