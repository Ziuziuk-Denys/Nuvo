mod common;

use nuvo_contracts::RecordPlaybackEvent;
use nuvo_store::{StoreError, events, library, library::SavedKind, stats};
use serde_json::{Value, json};

const DAY: i64 = 86_400_000;
const NOW: i64 = 100 * DAY;

fn event(track_id: &str, artist: &str, extra: Value) -> RecordPlaybackEvent {
    let mut body = json!({
        "listeningSessionId": "s1",
        "trackId": track_id,
        "trackSnapshot": common::track(track_id, artist),
        "playedDurationMs": 200000,
        "trackDurationMs": 200000,
        "completed": true,
        "skipped": false,
    });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    serde_json::from_value(body).unwrap()
}

fn play(conn: &nuvo_store::Connection, track_id: &str, artist: &str, extra: Value) {
    events::record(conn, &event(track_id, artist, extra), NOW).unwrap();
}

#[test]
fn records_and_lists_history_newest_first() {
    let (_dir, conn) = common::open();
    play(&conn, "a", "X", json!({"context": {"type": "playlist", "id": "p1"}, "startedAt": NOW - 2000}));
    play(&conn, "b", "X", json!({"completed": false, "skipped": true, "playedDurationMs": 5000, "startedAt": NOW - 1000}));
    let page = events::history(&conn, 10, None, None).unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.items[0].track["id"], "b");
    assert!(page.items[0].skipped && !page.items[0].completed);
    assert_eq!(page.items[0].completion_rate, 0.025);
    assert_eq!(page.items[1].context.as_ref().unwrap().id.as_deref(), Some("p1"));
    assert_eq!(page.items[1].listening_session_id, "s1");
}

#[test]
fn history_cursor_pages_without_overlap() {
    let (_dir, conn) = common::open();
    for i in 0..5 {
        play(&conn, &format!("t{i}"), "X", json!({}));
    }
    let first = events::history(&conn, 3, None, None).unwrap();
    let second = events::history(&conn, 3, first.next_cursor.as_deref(), None).unwrap();
    assert_eq!(first.items.len() + second.items.len(), 5);
    assert!(second.next_cursor.is_none());
    assert!(matches!(events::history(&conn, 3, Some("x"), None).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn end_reason_is_derived_for_old_clients_and_validated_for_new_ones() {
    let (_dir, conn) = common::open();
    play(&conn, "a", "X", json!({}));
    play(&conn, "b", "X", json!({"completed": false, "skipped": true}));
    play(&conn, "c", "X", json!({"completed": false, "skipped": false}));
    play(&conn, "d", "X", json!({"completed": false, "endReason": "next"}));
    let reasons: Vec<String> = conn
        .prepare("SELECT end_reason FROM play_events ORDER BY id").unwrap()
        .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(reasons, ["complete", "skip", "stop", "next"]);
    let bad = event("e", "X", json!({"endReason": "bored"}));
    assert!(matches!(events::record(&conn, &bad, NOW).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn hour_and_weekday_use_the_client_offset() {
    let (_dir, conn) = common::open();
    // 100 days after the epoch is a Saturday (weekday 6); 00:30 UTC is 02:30 at UTC+2.
    play(&conn, "a", "X", json!({"startedAt": NOW + 30 * 60_000, "tzOffsetMin": -120}));
    let (hour, weekday): (i64, i64) = conn.query_row("SELECT hour, weekday FROM play_events", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((hour, weekday), (2, 6));
}

#[test]
fn unknown_track_without_snapshot_is_rejected() {
    let (_dir, conn) = common::open();
    let mut e = event("ghost", "X", json!({}));
    e.track_snapshot = None;
    assert!(matches!(events::record(&conn, &e, NOW).unwrap_err(), StoreError::NotFound("track")));
}

#[test]
fn popular_tracks_count_real_plays_inside_the_window() {
    let (_dir, conn) = common::open();
    for i in 0..3 {
        play(&conn, "a", "X", json!({"startedAt": NOW - DAY + i, "listeningSessionId": format!("s{i}")}));
    }
    play(&conn, "b", "X", json!({"startedAt": NOW - DAY}));
    play(&conn, "b", "X", json!({"startedAt": NOW - 20 * DAY}));
    play(&conn, "c", "X", json!({"completed": false, "skipped": true, "playedDurationMs": 4000, "startedAt": NOW - DAY}));
    library::like(&conn, "b", None, NOW).unwrap();

    let week = stats::popular_tracks(&conn, "7d", 10, NOW).unwrap();
    let ids: Vec<_> = week.items.iter().map(|i| i.track["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["a", "b"], "skips under 30s do not count");
    assert_eq!((week.items[0].rank, week.items[0].play_count), (1, 3));
    assert!(week.items[1].viewer.liked);
    assert_eq!(stats::popular_tracks(&conn, "all", 10, NOW).unwrap().items[1].play_count, 2);
    assert!(matches!(stats::popular_tracks(&conn, "1y", 10, NOW).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn popular_albums_report_known_track_counts() {
    let (_dir, conn) = common::open();
    play(&conn, "a", "X", json!({"startedAt": NOW - DAY}));
    play(&conn, "b", "X", json!({"startedAt": NOW - DAY}));
    play(&conn, "c", "Y", json!({"startedAt": NOW - DAY}));
    let albums = stats::popular_albums(&conn, "7d", 10, NOW).unwrap();
    assert_eq!(albums.items[0].id, "al-X");
    assert_eq!((albums.items[0].play_count, albums.items[0].track_count), (2, 2));
    assert!(albums.items[0].cover_url.as_deref().unwrap().starts_with("https://img/"));
}

#[test]
fn most_saved_lists_saved_albums_and_playlists() {
    let (_dir, conn) = common::open();
    library::save_item(&conn, SavedKind::Album, "al1", Some(json!({"title": "A", "trackCount": 9, "cover": {"url": "u"}})), 1).unwrap();
    library::save_item(&conn, SavedKind::Playlist, "pl1", Some(json!({"title": "P"})), 2).unwrap();
    library::save_item(&conn, SavedKind::Artist, "ar1", None, 3).unwrap();
    let all = stats::most_saved(&conn, "all", 10).unwrap();
    assert_eq!(all.items.len(), 2);
    assert_eq!(all.items[1].subtitle, "9 tracks");
    assert_eq!(all.items[1].cover_url.as_deref(), Some("u"));
    assert_eq!(stats::most_saved(&conn, "album", 10).unwrap().items.len(), 1);
}

#[test]
fn empty_library_yields_empty_feeds() {
    let (_dir, conn) = common::open();
    assert!(stats::popular_tracks(&conn, "7d", 10, NOW).unwrap().items.is_empty());
    assert!(events::history(&conn, 10, None, None).unwrap().items.is_empty());
}

#[test]
fn history_filters_completed_and_skipped_across_pages() {
    let (_dir, conn) = common::open();
    for i in 0..6 {
        let extra = if i % 2 == 0 { json!({}) } else { json!({"completed": false, "skipped": true}) };
        play(&conn, &format!("t{i}"), "X", extra);
    }
    play(&conn, "stopped", "X", json!({"completed": false, "skipped": false}));

    let first = events::history(&conn, 2, None, Some("skipped")).unwrap();
    let second = events::history(&conn, 2, first.next_cursor.as_deref(), Some("skipped")).unwrap();
    let skipped: Vec<_> = first.items.iter().chain(&second.items).map(|i| i.track["id"].as_str().unwrap().to_string()).collect();
    assert_eq!(skipped, ["t5", "t3", "t1"]);
    assert!(second.next_cursor.is_none());

    let completed = events::history(&conn, 10, None, Some("completed")).unwrap();
    assert!(completed.items.iter().all(|i| i.completed));
    assert_eq!(completed.items.len(), 3);
    assert_eq!(events::history(&conn, 10, None, Some("all")).unwrap().items.len(), 7);
    assert!(matches!(events::history(&conn, 10, None, Some("loved")).unwrap_err(), StoreError::Invalid(_)));
}
