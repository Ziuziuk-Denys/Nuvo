mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::routing::get;
use axum::response::IntoResponse;
use axum::{Json, Router};
use nuvo_crypto::MemoryKeyStore;
use serde_json::{Value, json};

async fn mock_lrclib() -> (String, Arc<AtomicUsize>) {
    mock_lrclib_with(json!({"trackName": "Song", "artistName": "Artist", "duration": 200.0, "instrumental": false, "plainLyrics": "line", "syncedLyrics": "[00:01.00] line"})).await
}

async fn mock_lrclib_with(record: Value) -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let (get_hits, search_hits) = (hits.clone(), hits.clone());
    let app = Router::new()
        .route("/api/get", get(move || {
            get_hits.fetch_add(1, Ordering::SeqCst);
            let record = record.clone();
            async move { Json(record) }
        }))
        .route("/api/search", get(move || {
            search_hits.fetch_add(1, Ordering::SeqCst);
            async { Json(json!([])) }
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), hits)
}

fn events(body: &[u8]) -> Vec<Value> {
    String::from_utf8(body.to_vec())
        .unwrap()
        .split("\n\n")
        .filter_map(|raw| raw.lines().find_map(|l| l.strip_prefix("data:")).map(|d| serde_json::from_str(d.trim()).unwrap()))
        .collect()
}

#[tokio::test]
async fn streams_lrclib_lyrics_then_serves_them_from_cache() {
    let (url, hits) = mock_lrclib().await;
    let core = common::boot(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &url);
    let path = "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000";

    let (status, body, headers) = common::send(&core.app, common::request("GET", path, None)).await;
    assert_eq!(status, 200);
    assert_eq!(headers["content-type"], "text/event-stream");
    let first = events(&body);
    let kinds: Vec<_> = first.iter().map(|e| e["type"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["metadata", "provider", "done"]);
    assert_eq!(first[0]["track"]["title"], "Song");
    assert_eq!(first[1]["status"], "found");
    assert_eq!(first[1]["candidate"]["lyrics"]["format"], "lrc");
    assert_eq!(first[2]["cached"], false);
    assert_eq!(first[2]["best"]["syncLevel"], "line_level");

    let (_, body, _) = common::send(&core.app, common::request("GET", path, None)).await;
    let second = events(&body);
    assert_eq!(second[2]["cached"], true);
    assert_eq!(hits.load(Ordering::SeqCst), 1, "second request is served from the encrypted cache");
}

const WORD_TTML: &str = r#"<tt><body><div><p begin="00:01.000" end="03:10.000"><span begin="00:01.000" end="03:10.000">One</span></p></div></body></tt>"#;

async fn mock_words() -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let (index_hits, file_hits) = (hits.clone(), hits.clone());
    let app = Router::new()
        .route("/metadata/raw-lyrics-index.jsonl", get(move || {
            index_hits.fetch_add(1, Ordering::SeqCst);
            async { json!({"metadata": [["musicName", ["Song"]], ["artists", ["Artist"]]], "rawLyricFile": "song.ttml"}).to_string() }
        }))
        .route("/raw-lyrics/song.ttml", get(move || {
            file_hits.fetch_add(1, Ordering::SeqCst);
            async { WORD_TTML }
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), hits)
}

fn boot_words(lrclib: &str, words: &str) -> common::TestCore {
    let (lrclib, words) = (lrclib.to_string(), words.to_string());
    common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), move |config| {
        config.lrclib_url = lrclib;
        config.amll_url = words;
    })
}

#[tokio::test]
async fn a_word_timed_version_joins_the_stream_and_both_are_cached() {
    let (lines, line_hits) = mock_lrclib().await;
    let (words, word_hits) = mock_words().await;
    let core = boot_words(&lines, &words);
    let path = "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000";

    let (_, body, _) = common::send(&core.app, common::request("GET", path, None)).await;
    let first = events(&body);
    let found: Vec<_> = first.iter().filter(|e| e["status"] == "found").map(|e| e["provider"].as_str().unwrap()).collect();
    assert_eq!(found.len(), 2);
    assert!(found.contains(&"lrclib") && found.contains(&"amll"));
    let done = first.last().unwrap();
    assert_eq!(done["type"], "done");
    assert_eq!(done["best"]["syncLevel"], "word_level");

    let (lines_before, words_before) = (line_hits.load(Ordering::SeqCst), word_hits.load(Ordering::SeqCst));
    let (_, body, _) = common::send(&core.app, common::request("GET", path, None)).await;
    let second = events(&body);
    assert_eq!(second.iter().filter(|e| e["status"] == "found").count(), 2);
    assert_eq!((line_hits.load(Ordering::SeqCst), word_hits.load(Ordering::SeqCst)), (lines_before, words_before), "no network on the second play");
}

#[tokio::test]
async fn a_song_cached_before_the_word_source_still_looks_it_up_once() {
    let (lines, _) = mock_lrclib().await;
    let (words, word_hits) = mock_words().await;
    let core = boot_words(&lines, &words);
    let line = json!({"provider": "lrclib", "contentKind": "line_synced", "syncLevel": "line_level", "quality": {"total": 0.8, "match": 1.0, "content": 1.0, "sync": 1.0, "source": 0.7, "reasons": []}, "lyrics": {"format": "lrc", "content": "[00:01.00] line"}, "matchedTrack": null, "topPriority": false});
    let candidate: nuvo_contracts::LyricsCandidate = serde_json::from_value(line).unwrap();
    let data = core.state.data().unwrap();
    data.db.call(move |c| nuvo_store::lyrics_cache::put(c, "t1", Some(&candidate), false, 1)).await.unwrap();

    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000", None)).await;
    assert!(events(&body).iter().any(|e| e["provider"] == "amll" && e["status"] == "found"));
    assert!(word_hits.load(Ordering::SeqCst) > 0);
}

#[tokio::test]
async fn a_word_version_alone_is_enough_and_a_miss_is_remembered() {
    let (words, word_hits) = mock_words().await;
    let core = boot_words("http://127.0.0.1:9", &words);
    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000", None)).await;
    let list = events(&body);
    let done = list.last().unwrap();
    assert_eq!(done["best"]["provider"], "amll");
    assert!(done["status"].is_null());

    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t2/lyrics?title=Other&artist=Artist&durationMs=200000", None)).await;
    assert_eq!(events(&body).last().unwrap()["status"], "not_found");
    let before = word_hits.load(Ordering::SeqCst);
    common::send(&core.app, common::request("GET", "/v1/tracks/t2/lyrics?title=Other&artist=Artist&durationMs=200000", None)).await;
    assert_eq!(word_hits.load(Ordering::SeqCst), before);
}

#[tokio::test]
async fn a_word_source_that_is_down_changes_nothing_and_is_retried() {
    let (lines, _) = mock_lrclib().await;
    let core = boot_words(&lines, "http://127.0.0.1:9");
    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000", None)).await;
    let list = events(&body);
    let kinds: Vec<_> = list.iter().map(|e| e["type"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["metadata", "provider", "done"]);
    assert_eq!(list[2]["best"]["provider"], "lrclib");
    let data = core.state.data().unwrap();
    let row = data.db.call(|c| nuvo_store::lyrics_cache::get(c, "t1#words")).await.unwrap();
    assert!(row.is_none(), "a failed lookup leaves no miss behind");
}

#[tokio::test]
async fn enhanced_lrc_from_any_source_is_word_level() {
    let (url, _) = mock_lrclib_with(json!({"trackName": "Song", "artistName": "Artist", "duration": 200.0, "instrumental": false, "plainLyrics": "a b", "syncedLyrics": "[00:01.00]<00:01.00>a <00:01.50>b"})).await;
    let core = common::boot(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &url);
    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000", None)).await;
    assert_eq!(events(&body)[1]["candidate"]["syncLevel"], "word_level");

    let core = common::core();
    common::send(&core.app, common::request("PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "lrc", "content": "[00:01.00]<00:01.00>a <00:01.50>b"})))).await;
    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t1/lyrics", None)).await;
    assert_eq!(events(&body)[1]["candidate"]["syncLevel"], "word_level");
    assert_eq!(nuvo_server::routes::lyrics::sidecar_candidate("[00:01.00]<00:01.00>a <00:01.50>b".into()).sync_level, "word_level");
}

#[tokio::test]
async fn unreachable_provider_reports_an_error_and_not_found() {
    let core = common::core();
    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t1/lyrics?title=Song&artist=Artist", None)).await;
    let events = events(&body);
    assert_eq!(events[1]["status"], "error");
    assert!(events[1]["message"].is_string());
    assert_eq!(events[2]["status"], "not_found");
}

#[tokio::test]
async fn no_hint_and_unknown_track_is_not_found_without_a_network_call() {
    let (url, hits) = mock_lrclib().await;
    let core = common::boot(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &url);
    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/unknown/lyrics", None)).await;
    assert_eq!(events(&body)[1]["status"], "not_found");
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

fn offset_put(id: &str, body: Value) -> axum::http::Request<axum::body::Body> {
    common::request("PUT", &format!("/v1/tracks/{id}/lyrics/offset"), Some(body))
}

async fn metadata_offset(core: &common::TestCore, id: &str) -> Value {
    let (_, body, _) = common::send(&core.app, common::request("GET", &format!("/v1/tracks/{id}/lyrics"), None)).await;
    events(&body)[0]["offsetMs"].clone()
}

#[tokio::test]
async fn offsets_are_clamped_cleared_and_sent_with_the_metadata() {
    let core = common::core();
    assert_eq!(metadata_offset(&core, "t1").await, 0);

    let (status, body, _) = common::send(&core.app, offset_put("t1", json!({"offsetMs": 45000}))).await;
    assert_eq!(status, 200);
    assert_eq!(serde_json::from_slice::<Value>(&body).unwrap()["offsetMs"], 30000);
    assert_eq!(metadata_offset(&core, "t1").await, 30000);

    let (_, body, _) = common::send(&core.app, offset_put("t1", json!({"offsetMs": -120.4}))).await;
    assert_eq!(serde_json::from_slice::<Value>(&body).unwrap()["offsetMs"], -120);

    common::send(&core.app, offset_put("t1", json!({"offsetMs": 0}))).await;
    assert_eq!(metadata_offset(&core, "t1").await, 0);
}

#[tokio::test]
async fn legacy_offsets_import_once_without_overwriting() {
    let core = common::core();
    common::send(&core.app, offset_put("b", json!({"offsetMs": -200}))).await;
    let body = json!({"offsets": {"a": 300, "b": 900, "c": 0, "d": 50000}});
    let (status, answer, _) = common::send(&core.app, common::request("PUT", "/v1/lyrics/offsets", Some(body))).await;
    assert_eq!(status, 200);
    assert_eq!(serde_json::from_slice::<Value>(&answer).unwrap()["imported"], 2);
    for (id, want) in [("a", 300), ("b", -200), ("c", 0), ("d", 30000)] {
        assert_eq!(metadata_offset(&core, id).await, want, "track {id}");
    }
}

#[tokio::test]
async fn offset_routes_reject_bad_input() {
    let core = common::core();
    let long = "x".repeat(300);
    let (status, _, _) = common::send(&core.app, offset_put(&long, json!({"offsetMs": 100}))).await;
    assert_eq!(status, 400);
    let (status, _, _) = common::send(&core.app, offset_put("t", json!({"offsetMs": "soon"}))).await;
    assert_eq!(status, 400);
    let many: serde_json::Map<String, Value> = (0..10_001).map(|i| (format!("t{i}"), json!(100))).collect();
    let (status, _, _) = common::send(&core.app, common::request("PUT", "/v1/lyrics/offsets", Some(json!({"offsets": many})))).await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn an_instrumental_track_ends_with_the_instrumental_status_live_and_cached() {
    let record = json!({"trackName": "Song", "artistName": "Artist", "duration": 200.0, "instrumental": true, "plainLyrics": null, "syncedLyrics": null});
    let (url, hits) = mock_lrclib_with(record).await;
    let core = common::boot(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &url);
    let path = "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000";
    for _ in 0..2 {
        let (_, body, _) = common::send(&core.app, common::request("GET", path, None)).await;
        let events = events(&body);
        assert_eq!(events[1]["status"], "not_found");
        assert_eq!(events.last().unwrap()["status"], "instrumental");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1, "the second answer comes from the cache");
}

const USER: &str = "/v1/tracks/t1/lyrics/user";
const STREAM: &str = "/v1/tracks/t1/lyrics?title=Song&artist=Artist";

#[tokio::test]
async fn user_lyrics_come_first_and_can_be_dropped() {
    let core = common::core();
    let (status, _) = common::call(&core.app, "PUT", USER, Some(json!({"format": "lrc", "content": "[00:01.00] mine"}))).await;
    assert_eq!(status, 204);

    let (_, body, _) = common::send(&core.app, common::request("GET", STREAM, None)).await;
    let first = events(&body);
    assert_eq!(first[1]["provider"], "user");
    assert_eq!(first[1]["status"], "found");
    assert_eq!(first[1]["candidate"]["topPriority"], true);
    assert_eq!(first[1]["candidate"]["lyrics"]["format"], "lrc");
    assert_eq!(first[1]["candidate"]["lyrics"]["content"], "[00:01.00] mine");

    let (status, _) = common::call(&core.app, "DELETE", USER, None).await;
    assert_eq!(status, 204);
    let (_, body, _) = common::send(&core.app, common::request("GET", STREAM, None)).await;
    assert!(events(&body).iter().all(|event| event["provider"] != "user"));
}

#[tokio::test]
async fn dropping_user_lyrics_keeps_the_offset() {
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/offset", Some(json!({"offsetMs": 300}))).await;
    common::call(&core.app, "PUT", USER, Some(json!({"format": "plain", "content": "line"}))).await;
    common::call(&core.app, "DELETE", USER, None).await;
    let (_, body, _) = common::send(&core.app, common::request("GET", STREAM, None)).await;
    assert_eq!(events(&body)[0]["offsetMs"], 300);
}

#[tokio::test]
async fn provider_candidates_carry_no_top_priority() {
    let (url, _) = mock_lrclib().await;
    let core = common::boot(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &url);
    let (_, body, _) = common::send(&core.app, common::request("GET", "/v1/tracks/t1/lyrics?title=Song&artist=Artist&durationMs=200000", None)).await;
    assert!(events(&body)[1]["candidate"].get("topPriority").is_none());
}

#[tokio::test]
async fn bad_user_lyrics_are_refused() {
    let core = common::core();
    for body in [
        json!({"format": "lrc", "content": "no stamps here"}),
        json!({"format": "srt", "content": "1\n00:00:01,000 --> 00:00:02,000\nline"}),
        json!({"format": "plain", "content": "   "}),
        json!({"format": "plain", "content": "a".repeat(64 * 1024 + 1)}),
    ] {
        let (status, _) = common::call(&core.app, "PUT", USER, Some(body)).await;
        assert_eq!(status, 400);
    }
}

#[tokio::test]
async fn a_soundcloud_upload_finds_lyrics_under_its_performer_and_clean_title() {
    let asked = Arc::new(std::sync::Mutex::new(Vec::<(String, String)>::new()));
    let seen = asked.clone();
    let app = Router::new()
        .route("/api/get", get(move |axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>| {
            let (artist, title) = (q["artist_name"].clone(), q["track_name"].clone());
            seen.lock().unwrap().push((artist.clone(), title.clone()));
            async move {
                if (artist.as_str(), title.as_str()) == ("Linkin Park", "Numb") {
                    Json(json!({"trackName": "Numb", "artistName": "Linkin Park", "duration": 187.0, "instrumental": false, "plainLyrics": "line", "syncedLyrics": "[00:01.00] line"})).into_response()
                } else {
                    axum::http::StatusCode::NOT_FOUND.into_response()
                }
            }
        }))
        .route("/api/search", get(|| async { Json(json!([])) }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let core = common::boot(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &format!("http://{addr}"));

    let path = "/v1/tracks/sc:1066092496/lyrics?title=Linkin%20Park%20-%20Numb%20(slowed%20%2B%20reverb)%20%5BFREE%5D&artist=arushi&durationMs=187000";
    let (_, body, _) = common::send(&core.app, common::request("GET", path, None)).await;
    let list = events(&body);
    assert_eq!(list.last().unwrap()["best"]["provider"], "lrclib");
    assert_eq!(asked.lock().unwrap()[0], ("Linkin Park".to_string(), "Numb".to_string()));
}
