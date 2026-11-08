mod common;

use nuvo_contracts::{CreatePlaylist, RecordPlaybackEvent, UpdatePlaylist};
use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_store::{events, library, playlists};
use serde_json::json;

const DAY: i64 = 86_400_000;
const NOW: i64 = 100 * DAY;

fn entry(conn: &nuvo_store::Connection, id: &str, size: i64, last_played: i64) {
    let e = CacheEntry { track_id: id.into(), path: format!("/c/{id}.lac"), size_bytes: size, mime: "audio/webm".into(), codec: Some("opus".into()) };
    cache_index::upsert(conn, &e, last_played).unwrap();
}

fn complete(conn: &nuvo_store::Connection, id: &str, at: i64) {
    let body: RecordPlaybackEvent = serde_json::from_value(json!({
        "listeningSessionId": "s", "trackId": id, "trackSnapshot": common::track(id, "X"),
        "playedDurationMs": 1000, "completed": true, "startedAt": at
    })).unwrap();
    events::record(conn, &body, NOW).unwrap();
}

#[test]
fn upsert_get_touch_delete() {
    let (_dir, conn) = common::open();
    entry(&conn, "a", 10, 1);
    let got = cache_index::get(&conn, "a").unwrap().unwrap();
    assert_eq!((got.size_bytes, got.mime.as_str(), got.codec.as_deref()), (10, "audio/webm", Some("opus")));
    cache_index::touch(&conn, "a", 5).unwrap();
    entry(&conn, "b", 20, 2);
    assert_eq!(cache_index::total_bytes(&conn).unwrap(), 30);
    cache_index::delete(&conn, "a").unwrap();
    assert!(cache_index::get(&conn, "a").unwrap().is_none());
    assert_eq!(cache_index::all(&conn).unwrap().len(), 1);
}

#[test]
fn keep_rules_protect_liked_pinned_and_frequently_completed_tracks() {
    let (_dir, conn) = common::open();
    for id in ["liked", "pinned", "loved", "old", "fresh"] {
        entry(&conn, id, 100, NOW);
    }
    library::like(&conn, "liked", Some(common::track("liked", "X")), NOW).unwrap();
    let pid = playlists::create(&conn, &CreatePlaylist { title: "P".into(), description: None, is_public: false }, NOW).unwrap().id;
    playlists::add_track(&conn, &pid, "pinned", Some(common::track("pinned", "X")), NOW).unwrap();
    playlists::update(&conn, &pid, &UpdatePlaylist { pinned_offline: Some(true), ..Default::default() }, NOW).unwrap();
    for i in 0..3 {
        complete(&conn, "loved", NOW - DAY + i);
    }
    // Three completes, but 40 days ago: outside the 30-day window.
    for i in 0..3 {
        complete(&conn, "old", NOW - 40 * DAY + i);
    }
    complete(&conn, "fresh", NOW - DAY);
    cache_index::touch(&conn, "old", NOW - 50 * DAY).unwrap();

    let order: Vec<String> = cache_index::eviction_candidates(&conn, NOW).unwrap().into_iter().map(|c| c.track_id).collect();
    assert_eq!(order, ["old", "fresh"], "fewest recent plays first, then least recently played");
    let status = cache_index::status(&conn, NOW, 1000).unwrap();
    assert_eq!((status.used_bytes, status.entries, status.pinned, status.limit_bytes), (500, 5, 3, 1000));
}

#[test]
fn missing_keep_tracks_lists_liked_tracks_without_a_cache_entry() {
    let (_dir, conn) = common::open();
    library::like(&conn, "a", Some(common::track("a", "X")), NOW - 2).unwrap();
    library::like(&conn, "b", Some(common::track("b", "X")), NOW - 1).unwrap();
    entry(&conn, "a", 1, NOW);
    let missing = cache_index::missing_keep_tracks(&conn, 10).unwrap();
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0]["id"], "b");
}
