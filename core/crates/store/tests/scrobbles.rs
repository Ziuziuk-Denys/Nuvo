mod common;

use nuvo_contracts::{RecordPlaybackEvent, SetTrim};
use nuvo_store::{events, scrobbles, settings, trims};
use serde_json::{Value, json};

const NOW: i64 = 1_700_000_000_000;

fn play(conn: &nuvo_store::Connection, id: &str, played_ms: i64, extra: Value) -> bool {
    let mut body = json!({
        "listeningSessionId": "s", "trackId": id, "trackSnapshot": common::track(id, "Artist"),
        "playedDurationMs": played_ms, "trackDurationMs": 200000, "completed": true, "startedAt": NOW
    });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    let event: RecordPlaybackEvent = serde_json::from_value(body).unwrap();
    events::record(conn, &event, NOW + played_ms).unwrap().queued
}

fn connect(conn: &nuvo_store::Connection) {
    settings::set(conn, settings::LASTFM_SESSION_KEY, &json!("sk-1")).unwrap();
}

#[test]
fn the_scrobble_rule() {
    assert!(!scrobbles::counts(30_000, 30_000), "a track must be longer than 30 s");
    assert!(scrobbles::counts(30_001, 15_001), "at least half");
    assert!(!scrobbles::counts(30_001, 15_000), "less than half");
    assert!(scrobbles::counts(600_000, 240_000), "4 minutes is enough for long tracks");
    assert!(!scrobbles::counts(600_000, 239_999));
    assert!(!scrobbles::counts(0, 1_000_000), "unknown duration never counts");
}

#[test]
fn plays_are_queued_only_while_connected_and_enabled() {
    let (_dir, conn) = common::open();
    assert!(!play(&conn, "a", 200_000, json!({})), "not connected");
    connect(&conn);
    assert!(play(&conn, "b", 100_000, json!({})));
    assert!(!play(&conn, "c", 5_000, json!({"completed": false, "skipped": true})), "too short a listen");
    settings::set(&conn, settings::LASTFM_ENABLED, &json!(false)).unwrap();
    assert!(!play(&conn, "d", 200_000, json!({})), "paused");
    assert_eq!(scrobbles::count(&conn).unwrap(), 1);

    let queued = scrobbles::due(&conn, NOW, 50).unwrap();
    assert_eq!(queued.len(), 1);
    let q = &queued[0];
    assert_eq!((q.artist.as_str(), q.track.as_str(), q.album.as_deref()), ("Artist", "Title b", Some("Album Artist")));
    assert_eq!((q.duration_s, q.played_at, q.attempts), (Some(200), NOW / 1000, 0));

    let meta = scrobbles::track_meta(&conn, "b").unwrap().unwrap();
    assert_eq!((meta.artist.as_str(), meta.title.as_str(), meta.duration_ms), ("Artist", "Title b", 200_000));
    assert_eq!(scrobbles::track_meta(&conn, "never-seen").unwrap(), None);
}

#[test]
fn a_trimmed_track_counts_against_its_kept_span() {
    let (_dir, conn) = common::open();
    connect(&conn);
    play(&conn, "warmup", 1_000, json!({"startedAt": NOW}));
    trims::set(&conn, "warmup", &SetTrim { start_ms: 60_000, end_ms: 100_000, track: None }, NOW).unwrap();
    assert!(play(&conn, "warmup", 40_000, json!({"startedAt": NOW + 1000})), "40 s of a 40 s trim is a full listen");
    trims::set(&conn, "warmup", &SetTrim { start_ms: 0, end_ms: 20_000, track: None }, NOW).unwrap();
    assert!(!play(&conn, "warmup", 20_000, json!({"startedAt": NOW + 2000})), "a 20 s span is too short to scrobble");
}

#[test]
fn failed_entries_back_off_and_batches_are_limited() {
    let (_dir, conn) = common::open();
    connect(&conn);
    for n in 0..60 {
        play(&conn, &format!("t{n}"), 200_000, json!({"startedAt": NOW + n}));
    }
    let batch = scrobbles::due(&conn, NOW, 50).unwrap();
    assert_eq!(batch.len(), 50);
    let ids: Vec<i64> = batch.iter().map(|q| q.id).collect();

    scrobbles::defer(&conn, &ids, NOW).unwrap();
    assert_eq!(scrobbles::due(&conn, NOW, 50).unwrap().len(), 10, "deferred entries wait");
    assert_eq!(scrobbles::due(&conn, NOW + 60_000, 100).unwrap().len(), 60, "first retry after a minute");
    scrobbles::defer(&conn, &ids, NOW + 60_000).unwrap();
    assert_eq!(scrobbles::due(&conn, NOW + 60_000 + 119_999, 100).unwrap().len(), 10);
    assert_eq!(scrobbles::due(&conn, NOW + 180_000, 100).unwrap()[0].attempts, 2);
    for _ in 0..20 {
        scrobbles::defer(&conn, &ids, NOW).unwrap();
    }
    assert_eq!(scrobbles::due(&conn, NOW + 3_600_000, 100).unwrap().len(), 60, "backoff stops growing at one hour");

    scrobbles::remove(&conn, &ids).unwrap();
    assert_eq!(scrobbles::count(&conn).unwrap(), 10);
}

#[test]
fn recording_the_same_event_twice_gives_one_history_row_and_one_queue_row() {
    let (_dir, conn) = common::open();
    connect(&conn);
    let event = {
        let body = json!({
            "listeningSessionId": "s", "trackId": "dup", "trackSnapshot": common::track("dup", "Artist"),
            "playedDurationMs": 200_000, "trackDurationMs": 200000, "completed": true, "startedAt": NOW
        });
        serde_json::from_value::<RecordPlaybackEvent>(body).unwrap()
    };
    assert!(events::record(&conn, &event, NOW + 200_000).unwrap().queued, "first record queues");
    let again = events::record(&conn, &event, NOW + 200_000).unwrap();
    assert_eq!((again.is_new, again.queued), (false, false), "second record is ignored");
    let history_count: i64 = conn.query_row("SELECT count(*) FROM play_events WHERE track_id = 'dup'", [], |r| r.get(0)).unwrap();
    assert_eq!(history_count, 1);
    assert_eq!(scrobbles::count(&conn).unwrap(), 1);
}

#[test]
fn old_scrobbles_are_dropped_and_all_can_be_cleared() {
    let (_dir, conn) = common::open();
    connect(&conn);
    for n in 0..3 {
        play(&conn, &format!("old{n}"), 200_000, json!({"startedAt": NOW - 20 * 24 * 3600 * 1000}));
    }
    for n in 0..2 {
        play(&conn, &format!("new{n}"), 200_000, json!({"startedAt": NOW}));
    }
    assert_eq!(scrobbles::count(&conn).unwrap(), 5);
    scrobbles::drop_old(&conn, NOW).unwrap();
    assert_eq!(scrobbles::count(&conn).unwrap(), 2, "entries older than 14 days dropped");
    scrobbles::clear_all(&conn).unwrap();
    assert_eq!(scrobbles::count(&conn).unwrap(), 0);
}
