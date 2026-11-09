mod common;

use std::time::Duration;

use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use nuvo_net::fixture::{Fixture, Reply};
use nuvo_store::settings;
use serde_json::{Value, json};

const ID_A: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const HOME: &str = "https://soundcloud.com/";
const HLS: &str = "https://cf-hls-media.sndcdn.com";

fn api(path: &str) -> String {
    format!("https://api-v2.soundcloud.com/{path}")
}

async fn fixture() -> Fixture {
    let fx = Fixture::start().await;
    fx.on(HOME, Reply::bytes("text/html", "<script src=\"https://a-v2.sndcdn.com/assets/app.js\"></script>"));
    fx.on("https://a-v2.sndcdn.com/assets/app.js", Reply::bytes("application/javascript", format!("({{client_id:\"{ID_A}\"}})")));
    fx
}

fn core(fx: &Fixture) -> common::TestCore {
    common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base)
}

fn track(id: u64, transcodings: Value) -> Value {
    json!({"id": id, "kind": "track", "title": format!("Song {id}"), "duration": 200000, "user": {"id": 9, "username": "dj"}, "media": {"transcodings": transcodings}})
}

fn hls_aac() -> Value {
    json!([{"url": api("media/1/hls"), "preset": "aac_160k", "format": {"protocol": "hls", "mime_type": "audio/mp4; codecs=\"mp4a.40.2\""}}])
}

fn serve_hls(fx: &Fixture) {
    fx.on(&api("tracks/1"), Reply::json(track(1, hls_aac())));
    fx.on(&api("media/1/hls"), Reply::json(json!({"url": format!("{HLS}/a/list.m3u8")})));
    fx.on(&format!("{HLS}/a/list.m3u8"), Reply::text("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\ns0.m4s\ns1.m4s\ns2.m4s\n"));
    for (name, body) in [("init.mp4", "II"), ("s0.m4s", "a"), ("s1.m4s", "bb"), ("s2.m4s", "c")] {
        fx.on(&format!("{HLS}/a/{name}"), Reply::bytes("audio/mp4", body));
    }
}

#[tokio::test]
async fn catalog_routes_answer_in_wire_shapes() {
    let fx = fixture().await;
    fx.on(&api("tracks/5"), Reply::json(json!({"id": 5, "title": "Song", "duration": 1000, "description": "notes", "user": {"id": 9, "username": "dj"}})));
    fx.on(&api("tracks/5/related"), Reply::json(json!({"collection": (40..100).map(|i| track(i, json!([]))).collect::<Vec<_>>()})));
    fx.on(&api("playlists/3"), Reply::json(json!({"id": 3, "title": "Mix", "user": {"id": 9, "username": "dj"}, "tracks": [track(31, json!([]))]})));
    fx.on(&api("users/9"), Reply::json(json!({"id": 9, "username": "dj", "avatar_url": "https://i1.sndcdn.com/avatars-9-large.jpg"})));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:5", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((body["id"].as_str(), body["durationMs"].as_i64(), body["description"].as_str()), (Some("sc:5"), Some(1000), Some("notes")));
    let (_, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:5/related", None).await;
    assert_eq!(body["items"].as_array().unwrap().len(), 25);
    let (_, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:5/related?limit=500", None).await;
    assert_eq!(body["items"].as_array().unwrap().len(), 50);
    let (_, album) = common::call(&core.app, "GET", "/v1/sc/sets/sc_playlist_3?view=album", None).await;
    assert_eq!((album["artists"][0]["id"].as_str(), album.get("author")), (Some("sc_user_9"), None));
    let (_, playlist) = common::call(&core.app, "GET", "/v1/sc/sets/sc_playlist_3?view=playlist", None).await;
    assert_eq!(playlist["author"], "dj");
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/sets/sc_playlist_3?view=feed", None).await.0, StatusCode::BAD_REQUEST);
    let (_, avatar) = common::call(&core.app, "GET", "/v1/sc/users/sc_user_9/avatar", None).await;
    assert_eq!(avatar, json!({"url": "https://i1.sndcdn.com/avatars-9-t500x500.jpg"}));
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/lookup?url=night%20owl", None).await, (StatusCode::OK, json!({"items": []})));
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/lookup?url=x&type=song", None).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn import_lists_a_set_as_rows() {
    let fx = fixture().await;
    fx.on(&api("resolve"), Reply::json(json!({"id": 3, "kind": "playlist", "title": "Mix"})));
    fx.on(&api("playlists/3"), Reply::json(json!({"id": 3, "title": "Mix", "user": {"id": 9, "username": "dj"}, "tracks": [track(31, json!([]))]})));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/import?url=https%3A%2F%2Fsoundcloud.com%2Fdj%2Fsets%2Fmix", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["label"], "Mix");
    assert!(body.get("likesOf").is_none());
    assert_eq!(body["rows"][0]["title"], "Song 31");
    assert_eq!(body["rows"][0]["artists"], json!(["dj"]));
    assert_eq!(body["rows"][0]["track"]["id"], "sc:31");
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/import?url=https%3A%2F%2Fexample.org%2Fx", None).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/import", None).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn search_answers_tracks_for_a_query() {
    let fx = fixture().await;
    fx.on(&api("search/tracks"), Reply::json(json!({"collection": (1..=30).map(|i| track(i, json!([]))).collect::<Vec<_>>()})));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/search?q=Mira%20Holt%20Paper%20Moons&limit=10", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 10);
    assert_eq!(body["items"][0]["id"], "sc:1");
    assert_eq!(fx.hits(&api("search/tracks"))[0].query["q"], "Mira Holt Paper Moons");
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/search?q=%20", None).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn errors_use_the_shared_shape() {
    let fx = fixture().await;
    fx.on(&api("tracks/1/related"), Reply::status(500));
    fx.on(&api("tracks/2"), Reply::status(404));
    fx.on(&api("tracks/3"), Reply::status(500));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/users/UC123", None).await;
    assert_eq!((status, body["code"].as_str(), body["message"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT"), Some("UC123 is not a SoundCloud id")));
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/tracks/sc:1/related", None).await, (StatusCode::OK, json!({"items": []})));
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:2", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::NOT_FOUND, Some("NOT_FOUND")));
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:3", None).await;
    assert_eq!((status, body["code"].as_str(), body["message"].as_str()), (StatusCode::BAD_GATEWAY, Some("UPSTREAM"), Some("SoundCloud answered 500")));
}

#[tokio::test]
async fn undiscoverable_client_id_is_503() {
    let fx = Fixture::start().await;
    fx.on(HOME, Reply::status(500));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:1", None).await;
    assert_eq!((status, body["code"].as_str(), body["message"].as_str()), (StatusCode::SERVICE_UNAVAILABLE, Some("SC_UNAVAILABLE"), Some("SoundCloud cannot be reached at the moment")));
}

#[tokio::test]
async fn the_discovered_id_survives_a_restart() {
    let fx = fixture().await;
    fx.on(&api("tracks/5"), Reply::json(track(5, json!([]))));
    let first = core(&fx);
    assert_eq!(common::call(&first.app, "GET", "/v1/sc/tracks/sc:5", None).await.0, StatusCode::OK);
    let data = first.state.data().unwrap();
    let mut stored = None;
    for _ in 0..100 {
        stored = data.db.call(|c| settings::get(c, settings::SOUNDCLOUD_CLIENT_ID)).await.unwrap();
        if stored.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(stored.unwrap()["id"], ID_A);
    let key = data.master;
    drop(data);
    let dir = first.dir;
    drop(first.state);
    let second = common::boot_net(dir, MemoryKeyStore::with_key(key), &fx.base);
    fx.on(&api("tracks/6"), Reply::json(track(6, json!([]))));
    assert_eq!(common::call(&second.app, "GET", "/v1/sc/tracks/sc:6", None).await.0, StatusCode::OK);
    assert_eq!(fx.count(HOME), 1, "no discovery after the restart");
    assert_eq!(fx.hits(&api("tracks/6"))[0].query["client_id"], ID_A);
}

#[tokio::test]
async fn progressive_tracks_stream_directly() {
    let fx = fixture().await;
    fx.on(&api("tracks/1"), Reply::json(track(1, json!([{"url": api("media/1/p"), "preset": "mp3_1_0", "format": {"protocol": "progressive", "mime_type": "audio/mpeg"}}]))));
    fx.on(&api("media/1/p"), Reply::json(json!({"url": "https://cf-media.sndcdn.com/a.mp3?Expires=1900000000"})));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/soundcloud:tracks:1/stream", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"kind": "direct", "url": "https://cf-media.sndcdn.com/a.mp3?Expires=1900000000", "expiresAt": "2030-03-17T17:46:40.000Z", "codec": "mp3", "mimeType": "audio/mpeg", "bitrate": 128000, "contentLength": null})
    );
}

#[tokio::test]
async fn hls_audio_is_cached_once_and_served_with_ranges() {
    let fx = fixture().await;
    serve_hls(&fx);
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:1/stream", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"kind": "local", "url": "nuvo-core://local/v1/sc/tracks/sc:1/audio", "expiresAt": null, "codec": "aac", "mimeType": "audio/mp4", "bitrate": 160000, "contentLength": 6})
    );
    let requests = fx.total();
    let (status, bytes, headers) = common::send(&core.app, common::request("GET", "/v1/sc/tracks/sc:1/audio", None)).await;
    assert_eq!((status, bytes.as_slice(), headers["content-type"].to_str().unwrap()), (StatusCode::OK, b"IIabbc".as_slice(), "audio/mp4"));
    let ranged = axum::http::Request::get("/v1/sc/tracks/sc:1/audio")
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("range", "bytes=0-1")
        .body(axum::body::Body::empty())
        .unwrap();
    let (status, bytes, headers) = common::send(&core.app, ranged).await;
    assert_eq!((status, bytes.as_slice(), headers["content-range"].to_str().unwrap()), (StatusCode::PARTIAL_CONTENT, b"II".as_slice(), "bytes 0-1/6"));
    let (_, again) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:1/stream", None).await;
    assert_eq!((again["kind"].as_str(), again["contentLength"].as_u64()), (Some("local"), Some(6)));
    assert_eq!(fx.total(), requests, "cached audio costs no SoundCloud request");
    assert_eq!(common::call(&core.app, "GET", "/v1/sc/tracks/sc:2/audio", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn two_stream_requests_for_one_hls_track_both_get_whole_audio() {
    let fx = fixture().await;
    serve_hls(&fx);
    let core = core(&fx);
    let (a, b) = tokio::join!(
        common::call(&core.app, "GET", "/v1/sc/tracks/sc:1/stream", None),
        common::call(&core.app, "GET", "/v1/sc/tracks/sc:1/stream", None)
    );
    for (status, body) in [a, b] {
        assert_eq!((status, body["kind"].as_str(), body["contentLength"].as_u64()), (StatusCode::OK, Some("local"), Some(6)));
    }
    let (_, bytes, _) = common::send(&core.app, common::request("GET", "/v1/sc/tracks/sc:1/audio", None)).await;
    assert_eq!(bytes, b"IIabbc");
    assert_eq!(audio_files(&core).len(), 1);
}

#[tokio::test]
async fn unplayable_tracks_are_409_with_a_reason() {
    let fx = fixture().await;
    fx.on(&api("tracks/1"), Reply::json(track(1, hls_aac())));
    fx.on(&api("media/1/hls"), Reply::json(json!({"url": format!("{HLS}/k/list.m3u8")})));
    fx.on(&format!("{HLS}/k/list.m3u8"), Reply::text("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\na.ts\n"));
    let core = core(&fx);
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/sc:1/stream", None).await;
    assert_eq!((status, body["code"].as_str(), body["reason"].as_str()), (StatusCode::CONFLICT, Some("SC_UNPLAYABLE"), Some("drm")));
    let (status, body) = common::call(&core.app, "GET", "/v1/sc/tracks/Ab3dE_fG9hI/stream", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
}

fn audio_files(core: &common::TestCore) -> Vec<String> {
    match std::fs::read_dir(core.dir.path().join("cache/audio")) {
        Ok(entries) => entries.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect(),
        Err(_) => Vec::new(),
    }
}

#[tokio::test]
async fn a_cancelled_stream_request_writes_nothing() {
    let fx = fixture().await;
    serve_hls(&fx);
    fx.on(&format!("{HLS}/a/s2.m4s"), Reply::bytes("audio/mp4", "c").after(Duration::from_secs(30)));
    let core = core(&fx);
    let app = core.app.clone();
    let request = tokio::spawn(async move { common::call(&app, "GET", "/v1/sc/tracks/sc:1/stream", None).await });
    while fx.count(&format!("{HLS}/a/s2.m4s")) == 0 {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    request.abort();
    let _ = request.await;
    assert!(audio_files(&core).is_empty(), "left {:?}", audio_files(&core));
    let data = core.state.data().unwrap();
    assert!(data.db.call(|c| nuvo_store::cache_index::get(c, "sc:1")).await.unwrap().is_none());
}

#[tokio::test]
async fn a_locked_library_refuses_hls_audio_but_serves_the_catalog() {
    let fx = fixture().await;
    serve_hls(&fx);
    let first = core(&fx);
    let locked = common::boot_net(first.dir, MemoryKeyStore::with_key([9u8; 32]), &fx.base);
    assert!(locked.state.is_locked());
    let (status, body) = common::call(&locked.app, "GET", "/v1/sc/tracks/sc:1/stream", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::LOCKED, Some("LOCKED")));
    let (status, _) = common::call(&locked.app, "GET", "/v1/sc/tracks/sc:1", None).await;
    assert_eq!(status, StatusCode::OK, "catalog routes do not need the library");
}

#[tokio::test]
async fn stream_answers_starting_not_locked_while_the_core_starts() {
    let (_dir, app) = common::starting();
    let (status, body) = common::call(&app, "GET", "/v1/sc/tracks/sc:1/stream", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::SERVICE_UNAVAILABLE, Some("CORE_STARTING")));
}
