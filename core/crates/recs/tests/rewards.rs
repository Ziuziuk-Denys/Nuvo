mod common;

use common::{DAY, NOW, play, skip};
use nuvo_recs::keys;
use nuvo_recs::rewards::{self, Outcome};
use serde_json::json;

fn rewards_of(conn: &nuvo_store::Connection) -> Vec<(String, Outcome, f64)> {
    keys::refresh(conn).unwrap();
    rewards::load(conn, 0, None).unwrap().into_iter().map(|r| (r.play.track_id, r.outcome, r.reward)).collect()
}

fn reward_of(conn: &nuvo_store::Connection, id: &str) -> f64 {
    rewards_of(conn).into_iter().rev().find(|(t, ..)| t == id).map(|(.., r)| r).unwrap()
}

#[test]
fn every_row_of_the_reward_table() {
    let (_dir, conn) = common::open();
    let t = NOW - DAY;
    play(&conn, "finished", "A", "s1", t, json!({}));
    play(&conn, "finished", "A", "s1", t + 1, json!({}));
    play(&conn, "at-once", "A", "s2", t + 2, skip(1000));
    play(&conn, "next-at-once", "A", "s2", t + 3, json!({"completed": false, "endReason": "next", "playedDurationMs": 14999}));
    play(&conn, "scrub-skip", "A", "s3", t + 4, json!({"completed": false, "endReason": "skip", "playedDurationMs": 90000, "seekForwardMs": 60000}));
    play(&conn, "later", "A", "s3", t + 5, skip(60_000));
    play(&conn, "past-half", "A", "s3", t + 6, skip(120_000));
    play(&conn, "skimmed", "A", "s4", t + 7, json!({"seekForwardMs": 30000}));
    play(&conn, "stopped", "A", "s4", t + 8, json!({"completed": false, "endReason": "stop", "playedDurationMs": 1000}));
    play(&conn, "failed", "A", "s4", t + 9, json!({"completed": false, "endReason": "error", "playedDurationMs": 1000}));
    let got = rewards_of(&conn);
    let expected = [
        ("finished", Outcome::Finished, 1.0),
        ("finished", Outcome::Finished, 1.5),
        ("at-once", Outcome::SkippedAtOnce, -1.0),
        ("next-at-once", Outcome::SkippedAtOnce, -1.0),
        ("scrub-skip", Outcome::ScrubSkipped, -1.5),
        ("later", Outcome::SkippedLater, -0.3),
        ("past-half", Outcome::Neutral, 0.0),
        ("skimmed", Outcome::Skimmed, 0.3),
        ("stopped", Outcome::Neutral, 0.0),
        ("failed", Outcome::Neutral, 0.0),
    ];
    assert_eq!(got.len(), expected.len());
    for ((id, outcome, reward), (want_id, want_outcome, want_reward)) in got.iter().zip(expected) {
        assert_eq!((id.as_str(), *outcome), (want_id, want_outcome));
        assert!((reward - want_reward).abs() < 1e-9, "{id}: {reward} != {want_reward}");
    }
}

#[test]
fn skip_penalties_follow_context_and_browsing() {
    let (_dir, conn) = common::open();
    let t = NOW - DAY;
    conn.execute("INSERT INTO playlists (id, title, created_at, updated_at) VALUES ('mine', 'Mine', 0, 0)", []).unwrap();
    play(&conn, "radio", "A", "s1", t, json!({"completed": false, "endReason": "skip", "playedDurationMs": 1000, "context": {"type": "radio", "id": "x"}}));
    play(&conn, "own", "A", "s1", t + 1, json!({"completed": false, "endReason": "skip", "playedDurationMs": 1000, "context": {"type": "playlist", "id": "mine"}}));
    play(&conn, "foreign", "A", "s1", t + 2, json!({"completed": false, "endReason": "skip", "playedDurationMs": 1000, "context": {"type": "playlist", "id": "catalog"}}));
    assert_eq!(reward_of(&conn, "radio"), -1.5);
    assert_eq!(reward_of(&conn, "own"), -0.5);
    assert_eq!(reward_of(&conn, "foreign"), -1.0);

    // Four skips in five plays: browsing, so penalties are halved; the finished play keeps +1.
    for i in 0..4 {
        play(&conn, &format!("b{i}"), "B", "browse", t + 10 + i, skip(1000));
    }
    play(&conn, "kept", "B", "browse", t + 20, json!({}));
    assert_eq!(reward_of(&conn, "b0"), -0.5);
    assert_eq!(reward_of(&conn, "kept"), 1.0);
}

#[test]
fn excluded_tracks_and_playlists_are_ignored() {
    let (_dir, conn) = common::open();
    let t = NOW - DAY;
    play(&conn, "sleep", "A", "s1", t, json!({"context": {"type": "playlist", "id": "sleep-sounds"}}));
    play(&conn, "kid-song", "B", "s1", t + 1, json!({}));
    play(&conn, "mine", "C", "s1", t + 2, json!({}));
    rewards::set_excluded(&conn, "playlist", "sleep-sounds", true).unwrap();
    rewards::set_excluded(&conn, "track", "kid-song", true).unwrap();
    let ids: Vec<String> = rewards_of(&conn).into_iter().map(|(id, ..)| id).collect();
    assert_eq!(ids, ["mine"]);
    assert_eq!(rewards::excluded(&conn).unwrap(), [("playlist".to_string(), "sleep-sounds".to_string()), ("track".into(), "kid-song".into())]);
    rewards::set_excluded(&conn, "playlist", "sleep-sounds", false).unwrap();
    assert_eq!(rewards_of(&conn).len(), 2);
    assert!(rewards::set_excluded(&conn, "album", "x", true).is_err());
    assert!(rewards::set_excluded(&conn, "track", &"x".repeat(257), true).is_err());
}

#[test]
fn affinity_is_decayed_smoothed_and_bucketed() {
    let (_dir, conn) = common::open();
    // 2026-10-26 is a Monday; 20:00 UTC with offset 0 is bucket 3 (18-24, weekday).
    let monday_evening = 1_792_972_800_000 + 20 * 3_600_000;
    play(&conn, "a", "Artist", "s1", monday_evening, json!({}));
    let liked_at = monday_evening;
    nuvo_store::library::like(&conn, "liked", Some(common::snapshot("liked", "Liked", "Other")), liked_at).unwrap();
    keys::refresh(&conn).unwrap();
    let aff = rewards::affinity(&conn, monday_evening).unwrap();
    assert!((aff.track("a") - 0.25).abs() < 1e-9, "one finished play: 1 / (1 + 3)");
    assert!((aff.artist("artist") - 0.25).abs() < 1e-9);
    assert!((aff.track("liked") - 0.75).abs() < 1e-9, "a like is +3");
    assert_eq!(rewards::bucket_now(monday_evening, 0), 3);
    assert!((aff.bucket("artist", 3) - 0.25).abs() < 1e-9);
    assert_eq!(aff.bucket("artist", 7), 0.0, "the weekend evening bucket is separate");
    assert_eq!(rewards::time_bucket(23, 6), 7);

    let later = rewards::affinity(&conn, monday_evening + 75 * DAY).unwrap();
    let decayed = (-1.0f64).exp();
    assert!((later.track("a") - decayed / (decayed + 3.0)).abs() < 1e-9, "75 days later the play weighs 1/e");
    assert_eq!(later.artist_outcomes["artist"], (1, 0));
}

#[test]
fn huge_play_times_do_not_overflow() {
    let play = rewards::Play {
        track_id: "t".into(),
        artist_key: "a".into(),
        session_id: "s".into(),
        started_at: NOW,
        played_ms: i64::MAX,
        duration_ms: Some(200_000),
        end_reason: "skip".into(),
        context: None,
        seek_forward_ms: 0,
        hour: 0,
        weekday: 0,
    };
    assert_eq!(rewards::outcome(&play), Outcome::Neutral);
}

#[test]
fn tracks_without_an_artist_share_no_artist_affinity() {
    let (_dir, conn) = common::open();
    for i in 0..3 {
        play(&conn, &format!("u{i}"), "?", "s", NOW - DAY + i, skip(1000));
    }
    keys::refresh(&conn).unwrap();
    let affinity = rewards::affinity(&conn, NOW).unwrap();
    assert!(affinity.track("u0") < 0.0);
    assert_eq!(affinity.artist(""), 0.0);
    assert_eq!(affinity.artist_play_count(""), 0);
}
