use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::extract::Query as AxumQuery;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use nuvo_lyrics::{Lookup, Lrclib, Query};
use serde_json::{Value, json};

fn record(id: i64, duration: f64, synced: Option<&str>, plain: Option<&str>, instrumental: bool) -> Value {
    json!({"id": id, "trackName": "Song", "artistName": "Artist", "albumName": "A", "duration": duration,
           "instrumental": instrumental, "plainLyrics": plain, "syncedLyrics": synced})
}

/// Mock LRCLIB: `/api/get` knows "Song" at 200 s, has an empty record for "Empty" and fails with 502
/// for "Busy"; `/api/search` returns `search` for any query.
async fn mock(search: Value) -> (String, Arc<AtomicUsize>) {
    let gets = Arc::new(AtomicUsize::new(0));
    let counter = gets.clone();
    let app = Router::new()
        .route("/api/get", get(move |AxumQuery(q): AxumQuery<HashMap<String, String>>| {
            counter.fetch_add(1, Ordering::SeqCst);
            async move {
                let title = q.get("track_name").map(String::as_str);
                if title == Some("Song") && q.get("duration").map(String::as_str) == Some("200") {
                    (StatusCode::OK, Json(record(1, 200.0, Some("[00:01.00] line"), Some("line"), false)))
                } else if title == Some("Empty") {
                    (StatusCode::OK, Json(record(8, 180.0, None, None, false)))
                } else if title == Some("Busy") {
                    (StatusCode::BAD_GATEWAY, Json(json!({"message": "upstream timeout"})))
                } else {
                    (StatusCode::NOT_FOUND, Json(json!({"code": 404, "name": "TrackNotFound"})))
                }
            }
        }))
        .route("/api/search", get(move || async move { Json(search) }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), gets)
}

fn query(title: &str, duration_ms: Option<i64>) -> Query {
    Query { title: title.into(), artist: "Artist".into(), duration_ms }
}

#[tokio::test]
async fn exact_match_returns_synced_lrc() {
    let (base, _) = mock(json!([])).await;
    let Lookup::Found(candidate) = Lrclib::new(base).lookup(&query("Song", Some(200_400))).await.unwrap() else {
        panic!("expected lyrics");
    };
    assert_eq!(candidate.provider, "lrclib");
    assert_eq!((candidate.lyrics.format.as_str(), candidate.sync_level.as_str(), candidate.content_kind.as_str()), ("lrc", "line_level", "line_synced"));
    assert_eq!(candidate.lyrics.content, "[00:01.00] line");
    assert_eq!(candidate.matched_track.unwrap().duration_ms, Some(200_000));
}

#[tokio::test]
async fn search_fallback_respects_the_two_second_window_and_prefers_synced() {
    let search = json!([
        record(2, 150.0, Some("[00:01.00] far"), None, false),
        record(3, 181.5, None, Some("plain near"), false),
        record(4, 179.0, Some("[00:01.00] synced near"), None, false),
    ]);
    let (base, _) = mock(search).await;
    let Lookup::Found(candidate) = Lrclib::new(base).lookup(&query("Other", Some(180_000))).await.unwrap() else {
        panic!("expected lyrics");
    };
    assert_eq!(candidate.lyrics.content, "[00:01.00] synced near");
}

#[tokio::test]
async fn plain_only_and_instrumental_results() {
    let (base, _) = mock(json!([record(5, 180.0, None, Some("just text"), false)])).await;
    let Lookup::Found(plain) = Lrclib::new(base).lookup(&query("Other", Some(180_000))).await.unwrap() else {
        panic!("expected plain lyrics");
    };
    assert_eq!((plain.lyrics.format.as_str(), plain.sync_level.as_str()), ("plain", "plain"));

    let (base, _) = mock(json!([record(6, 180.0, None, None, true)])).await;
    assert!(matches!(Lrclib::new(base).lookup(&query("Other", Some(180_000))).await.unwrap(), Lookup::Instrumental));
}

#[tokio::test]
async fn unknown_duration_skips_the_exact_endpoint() {
    let (base, gets) = mock(json!([record(7, 100.0, Some("[00:01.00] x"), None, false)])).await;
    assert!(matches!(Lrclib::new(base).lookup(&query("Song", None)).await.unwrap(), Lookup::Found(_)));
    assert_eq!(gets.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn nothing_found_and_unreachable_server() {
    let (base, _) = mock(json!([])).await;
    assert!(matches!(Lrclib::new(base).lookup(&query("Other", Some(1000))).await.unwrap(), Lookup::NotFound));
    assert!(Lrclib::new("http://127.0.0.1:9").lookup(&query("Song", Some(200_000))).await.is_err());
}

#[tokio::test]
async fn an_exact_hit_without_lyrics_or_a_5xx_falls_through_to_the_search() {
    let search = json!([record(9, 180.0, Some("[00:01.00] from search"), None, false)]);
    for title in ["Empty", "Busy"] {
        let (base, gets) = mock(search.clone()).await;
        let Lookup::Found(candidate) = Lrclib::new(base).lookup(&query(title, Some(180_000))).await.unwrap() else {
            panic!("expected lyrics from the search for {title}");
        };
        assert_eq!(candidate.lyrics.content, "[00:01.00] from search", "{title}");
        assert_eq!(gets.load(Ordering::SeqCst), 1, "{title}");
    }
}
