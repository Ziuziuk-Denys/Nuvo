use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use axum::routing::post;
use axum::{Form, Json, Router};
use nuvo_lastfm::{Credentials, Lastfm, LastfmError, Scrobble, TrackInfo, auth_url, sign, MAX_BATCH};
use serde_json::json;

const SECRET: &str = "s3cret";

fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
    list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

#[test]
fn signature_matches_the_lastfm_docs_example() {
    // Example from last.fm/api/desktopauth "Sign your calls"; its md5 is from coreutils md5sum
    let params = pairs(&[("token", "xxxxxxx"), ("method", "auth.getSession"), ("api_key", "xxxxxxxx")]);
    assert_eq!(sign(&params, "mysecret"), "68afb32bee072407a63b6c41f3e1e2b4");
    let with_format = pairs(&[("format", "json"), ("api_key", "xxxxxxxx"), ("token", "xxxxxxx"), ("method", "auth.getSession")]);
    assert_eq!(sign(&with_format, "mysecret"), "68afb32bee072407a63b6c41f3e1e2b4", "format is not signed and order does not matter");
    assert_eq!(sign(&[], "abc"), "900150983cd24fb0d6963f7d28e17f72", "RFC 1321 test vector");
}

#[test]
fn auth_page_url() {
    assert_eq!(auth_url("k1", "t1"), "https://www.last.fm/api/auth/?api_key=k1&token=t1");
}

async fn mock() -> (String, Arc<Mutex<Vec<Vec<(String, String)>>>>) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let app = Router::new().route(
        "/2.0/",
        post(move |Form(params): Form<Vec<(String, String)>>| {
            let seen = seen.clone();
            async move {
                let get = |name: &str| params.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()).unwrap_or_default();
                let unsigned: Vec<_> = params.iter().filter(|(k, _)| k != "api_sig").cloned().collect();
                seen.lock().unwrap().push(params.clone());
                if sign(&unsigned, SECRET) != get("api_sig") || get("format") != "json" {
                    return (StatusCode::FORBIDDEN, Json(json!({"error": 13, "message": "Invalid method signature supplied"})));
                }
                match get("method").as_str() {
                    "auth.getToken" => (StatusCode::OK, Json(json!({"token": "tok123"}))),
                    "auth.getSession" if get("token") == "tok123" => {
                        (StatusCode::OK, Json(json!({"session": {"name": "owner", "key": "sk-1", "subscriber": 0}})))
                    }
                    "auth.getSession" => (StatusCode::FORBIDDEN, Json(json!({"error": 14, "message": "Unauthorized Token"}))),
                    "track.updateNowPlaying" => (StatusCode::OK, Json(json!({"nowplaying": {}}))),
                    "track.scrobble" => (StatusCode::OK, Json(json!({"scrobbles": {"@attr": {"accepted": 2, "ignored": 0}}}))),
                    _ => (StatusCode::BAD_REQUEST, Json(json!({"error": 3, "message": "Invalid Method"}))),
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/2.0/"), calls)
}

fn creds(secret: &str) -> Credentials {
    Credentials { api_key: "key1".into(), api_secret: secret.into() }
}

fn song(n: i64) -> TrackInfo {
    TrackInfo { artist: format!("Artist {n}"), track: format!("Song {n}"), album: (n == 0).then(|| "Album".to_string()), duration_s: Some(200) }
}

#[tokio::test]
async fn desktop_auth_flow() {
    let (base, _) = mock().await;
    let client = Lastfm::new(base);
    let token = client.get_token(&creds(SECRET)).await.unwrap();
    assert_eq!(token, "tok123");
    let session = client.get_session(&creds(SECRET), &token).await.unwrap();
    assert_eq!((session.name.as_str(), session.key.as_str()), ("owner", "sk-1"));
    let err = client.get_session(&creds(SECRET), "unapproved").await.unwrap_err();
    assert!(matches!(err, LastfmError::Api { code: 14, .. }), "{err}");
    let err = client.get_token(&creds("wrong")).await.unwrap_err();
    assert!(matches!(err, LastfmError::Api { code: 13, .. }), "a wrong secret fails the signature");
}

#[tokio::test]
async fn now_playing_and_scrobble_send_indexed_fields() {
    let (base, calls) = mock().await;
    let client = Lastfm::new(base);
    client.now_playing(&creds(SECRET), "sk-1", &song(0)).await.unwrap();
    let batch = [Scrobble { track: song(0), timestamp: 1_700_000_000 }, Scrobble { track: song(1), timestamp: 1_700_000_300 }];
    let (accepted, ignored) = client.scrobble(&creds(SECRET), "sk-1", &batch).await.unwrap();
    assert_eq!((accepted, ignored), (2, 0));

    let calls = calls.lock().unwrap();
    let has = |call: &Vec<(String, String)>, k: &str, v: &str| call.iter().any(|(name, value)| name == k && value == v);
    assert!(has(&calls[0], "method", "track.updateNowPlaying") && has(&calls[0], "artist", "Artist 0") && has(&calls[0], "sk", "sk-1"));
    assert!(has(&calls[1], "artist[1]", "Artist 1") && has(&calls[1], "track[0]", "Song 0"));
    assert!(has(&calls[1], "timestamp[0]", "1700000000") && has(&calls[1], "timestamp[1]", "1700000300"));
    assert!(has(&calls[1], "album[0]", "Album") && !calls[1].iter().any(|(k, _)| k == "album[1]"));
    assert!(has(&calls[1], "duration[1]", "200"));
}

#[tokio::test]
async fn unreachable_and_non_json_failures() {
    let err = Lastfm::new("http://127.0.0.1:9/2.0/").get_token(&creds(SECRET)).await.unwrap_err();
    assert!(matches!(err, LastfmError::Http(_)));

    let app = Router::new().route("/2.0/", post(|| async { (StatusCode::BAD_GATEWAY, "upstream down") }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let err = Lastfm::new(format!("http://{addr}/2.0/")).get_token(&creds(SECRET)).await.unwrap_err();
    assert!(matches!(err, LastfmError::Status(502)));
}

#[tokio::test]
async fn scrobble_batch_validation() {
    let (base, _) = mock().await;
    let client = Lastfm::new(base);
    let err = client.scrobble(&creds(SECRET), "sk-1", &[]).await.unwrap_err();
    assert!(matches!(err, LastfmError::InvalidBatch), "empty batch rejected");

    let oversized = vec![Scrobble { track: song(0), timestamp: 0 }; MAX_BATCH + 1];
    let err = client.scrobble(&creds(SECRET), "sk-1", &oversized).await.unwrap_err();
    assert!(matches!(err, LastfmError::InvalidBatch), "oversized batch rejected");
}

#[test]
fn scrobble_indexed_field_order_is_stable() {
    let mut params = Vec::new();
    for i in 0..12 {
        let suffix = format!("[{i}]");
        params.push((format!("artist{suffix}"), format!("A{i}")));
        params.push((format!("track{suffix}"), format!("T{i}")));
    }
    let sig = sign(&params, "secret");
    let expected = "420ec9aa38f75cfa1f2ed48072dbc1f3";
    assert_eq!(sig, expected, "parameter order affects signature: artist[0], artist[1], ... artist[2] (not artist[10], artist[11], artist[2])");
}
