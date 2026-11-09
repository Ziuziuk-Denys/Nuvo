mod common;

use std::time::Instant;

use common::{KEY, open, track};
use nuvo_contracts::{RecordPlaybackEvent, day_from_iso, iso_day, local_day};
use nuvo_contracts::StatsOverview;
use nuvo_store::listening::{self, History, Period};
use nuvo_store::{Connection, StoreError, events, open_connection, tracks};
use rusqlite::params;
use serde_json::{Value, json};

const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
/// 2026-07-01 00:00 UTC.
const JULY: i64 = 1_782_864_000_000;

fn day(text: &str) -> i64 {
    day_from_iso(text).unwrap()
}

fn period(from: &str, to: &str, today: &str) -> Period {
    Period { from: Some(day(from)), to: Some(day(to)), today: day(today) }
}

fn all(today: &str) -> Period {
    Period { from: None, to: None, today: day(today) }
}

fn overview(conn: &Connection, range: Period) -> Result<StatsOverview, StoreError> {
    listening::overview(conn, &mut History::default(), range)
}

fn play(conn: &Connection, id: &str, session: &str, at: i64, played: i64, reason: &str, extra: Value) {
    let mut body = json!({
        "listeningSessionId": session, "trackId": id, "trackSnapshot": track(id, "Band"), "playedDurationMs": played,
        "trackDurationMs": 200000, "completed": reason == "complete", "skipped": reason == "skip", "endReason": reason,
        "startedAt": at, "tzOffsetMin": 0,
    });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    let event: RecordPlaybackEvent = serde_json::from_value(body).unwrap();
    events::record(conn, &event, at).unwrap();
}

fn keys(conn: &Connection) {
    conn.execute_batch(
        "INSERT OR REPLACE INTO track_keys (track_id, work_key, artist_key, computed_at)
         SELECT id, id, lower(artist), updated_at FROM tracks",
    )
    .unwrap();
}

#[test]
fn a_play_counts_when_completed_or_after_30_seconds_and_time_is_real() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 200_000, "complete", json!({}));
    play(&conn, "b", "s1", JULY + 1000, 31_000, "next", json!({}));
    play(&conn, "c", "s1", JULY + 2000, 4_000, "skip", json!({}));
    play(&conn, "d", "s1", JULY + 3000, 0, "skip", json!({}));
    play(&conn, "e", "s1", JULY + 4000, 0, "error", json!({}));
    let stats = overview(&conn, period("2026-07-01", "2026-07-01", "2026-07-01")).unwrap();
    assert_eq!(stats.totals.plays, 2);
    assert_eq!(stats.totals.listened_ms, 235_000);
    assert_eq!(stats.totals.tracks, 2);
    assert!((stats.totals.skip_rate - 1.0 / 3.0).abs() < 1e-9);
    assert!((stats.totals.completed_rate - 1.0 / 3.0).abs() < 1e-9);
}

#[test]
fn repeat_one_counts_every_round_as_a_play() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 600_000, "complete", json!({"loopCount": 3}));
    let stats = overview(&conn, all("2026-07-01")).unwrap();
    assert_eq!(stats.totals.plays, 3);
    assert_eq!(stats.most_replayed[0].replays, Some(2));
}

#[test]
fn days_follow_the_time_zone_of_each_play_across_a_change() {
    let (_dir, conn) = open();
    // 22:30 UTC on the 1st is the 2nd in UTC+3 and still the 1st in UTC+1
    play(&conn, "a", "s1", JULY + 22 * HOUR + 1_800_000, 60_000, "next", json!({"tzOffsetMin": -180}));
    play(&conn, "b", "s2", JULY + 22 * HOUR + 1_800_000, 60_000, "next", json!({"tzOffsetMin": -60}));
    play(&conn, "c", "s3", JULY + 3 * DAY, 60_000, "next", json!({"tzOffsetMin": 300}));
    let stats = overview(&conn, all("2026-07-10")).unwrap();
    let days: Vec<_> = stats.days.iter().map(|d| (d.day.as_str(), d.plays)).collect();
    assert_eq!(days, [("2026-07-01", 1), ("2026-07-02", 1), ("2026-07-03", 1)]);
    assert_eq!(stats.by_hour[1], 60_000);
    assert_eq!(stats.by_hour[23], 60_000);
    assert_eq!(stats.by_hour[19], 60_000);
    // the 1st of July 2026 is a Wednesday
    assert_eq!(stats.by_weekday[3], 60_000);
    assert_eq!(stats.by_weekday[4], 60_000);
}

#[test]
fn period_boundaries_are_local_days_and_previous_has_the_same_length() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY - 1000, 60_000, "next", json!({}));
    play(&conn, "b", "s2", JULY, 60_000, "next", json!({}));
    play(&conn, "c", "s3", JULY + 7 * DAY - 1000, 60_000, "next", json!({}));
    play(&conn, "d", "s4", JULY + 7 * DAY, 60_000, "next", json!({}));
    play(&conn, "e", "s5", JULY - 7 * DAY, 60_000, "next", json!({}));
    play(&conn, "f", "s6", JULY - 7 * DAY - 1000, 60_000, "next", json!({}));
    let stats = overview(&conn, period("2026-07-01", "2026-07-07", "2026-07-20")).unwrap();
    assert_eq!(stats.totals.plays, 2);
    assert_eq!(stats.range.days, 7);
    assert_eq!(stats.range.previous_from.as_deref(), Some("2026-06-24"));
    assert_eq!(stats.range.previous_to.as_deref(), Some("2026-06-30"));
    assert_eq!(stats.previous.unwrap().plays, 2);
    assert!(overview(&conn, all("2026-07-20")).unwrap().previous.is_none());
    assert!(overview(&conn, period("2026-07-07", "2026-07-01", "2026-07-20")).is_err());
}

#[test]
fn streaks_break_on_a_day_without_a_counted_play() {
    let (_dir, conn) = open();
    for (index, offset) in [0, 1, 2, 4, 5].iter().enumerate() {
        play(&conn, "a", &format!("s{index}"), JULY + offset * DAY, 60_000, "next", json!({}));
    }
    play(&conn, "a", "x", JULY + 3 * DAY, 5_000, "skip", json!({}));
    let stats = overview(&conn, all("2026-07-07")).unwrap();
    assert_eq!(stats.current_streak, 2);
    assert_eq!(stats.longest_streak.days, 3);
    assert_eq!(stats.longest_streak.from.as_deref(), Some("2026-07-01"));
    assert_eq!(stats.totals.active_days, 5);
    assert_eq!(overview(&conn, all("2026-07-08")).unwrap().current_streak, 0);
}

#[test]
fn tops_rank_and_move_against_the_previous_period() {
    let (_dir, conn) = open();
    for index in 0..3 {
        play(&conn, "old", &format!("p{index}"), JULY - 3 * DAY + index, 60_000, "next", json!({}));
    }
    play(&conn, "riser", "p9", JULY - 3 * DAY + 10, 60_000, "next", json!({}));
    for index in 0..3 {
        play(&conn, "riser", &format!("n{index}"), JULY + index, 60_000, "next", json!({}));
    }
    play(&conn, "old", "n8", JULY + 10, 60_000, "next", json!({}));
    play(&conn, "fresh", "n9", JULY + 20, 40_000, "next", json!({}));
    keys(&conn);
    let stats = overview(&conn, period("2026-07-01", "2026-07-07", "2026-07-07")).unwrap();
    let rows: Vec<_> = stats.top.tracks.iter().map(|r| (r.id.as_str(), r.plays, r.rank, r.rank_delta, r.is_new)).collect();
    assert_eq!(rows, [("riser", 3, 1, Some(1), false), ("old", 1, 2, Some(-1), false), ("fresh", 1, 3, None, true)]);
    assert_eq!(stats.top.tracks[0].track.as_ref().unwrap()["id"], "riser");
    assert_eq!(stats.top.artists[0].title, "Band");
    assert_eq!(stats.top.artists[0].plays, 5);
    assert_eq!(stats.top.albums[0].open_id.as_deref(), Some("al-Band"));
    assert_eq!(stats.new_tracks, 1);
    assert_eq!(stats.discoveries[0].id, "fresh");
    assert_eq!(stats.new_artists, 0);
}

#[test]
fn nothing_is_new_without_a_previous_listen() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 60_000, "next", json!({}));
    let stats = overview(&conn, period("2026-07-01", "2026-07-07", "2026-07-07")).unwrap();
    assert!(!stats.top.tracks[0].is_new);
}

#[test]
fn artists_group_by_key_so_a_topic_channel_is_one_artist() {
    let (_dir, conn) = open();
    let mut snapshot = track("a", "Band");
    snapshot["artists"] = json!([{"id": "x", "name": "Band - Topic"}]);
    tracks::upsert(&conn, &snapshot, JULY).unwrap();
    play(&conn, "b", "s1", JULY, 60_000, "next", json!({}));
    play(&conn, "a", "s1", JULY + 1, 60_000, "next", json!({"trackSnapshot": snapshot}));
    keys(&conn);
    conn.execute("UPDATE track_keys SET artist_key = 'band'", []).unwrap();
    let stats = overview(&conn, all("2026-07-01")).unwrap();
    assert_eq!(stats.totals.artists, 1);
    assert_eq!(stats.top.artists[0].plays, 2);
}

#[test]
fn sources_tell_what_started_the_music_and_where_it_came_from() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 60_000, "next", json!({"context": {"type": "playlist", "id": "likes"}, "source": "cache"}));
    play(&conn, "b", "s1", JULY + 1, 60_000, "next", json!({"context": {"type": "radio", "id": "a"}, "source": "youtube"}));
    play(&conn, "c", "s1", JULY + 2, 60_000, "next", json!({"context": {"type": "continue", "id": "q"}, "source": "soundcloud"}));
    play(&conn, "d", "s1", JULY + 3, 60_000, "next", json!({"context": {"type": "search"}, "source": "made up"}));
    play(&conn, "e", "s1", JULY + 4, 60_000, "next", json!({"context": {"type": "Some Artist Name"}}));
    let stats = overview(&conn, all("2026-07-01")).unwrap();
    let share = |list: &[nuvo_contracts::StatsShare], kind: &str| list.iter().find(|s| s.kind == kind).map(|s| s.plays);
    assert_eq!(share(&stats.sources, "radio"), Some(2));
    assert_eq!(share(&stats.sources, "search"), Some(1));
    assert_eq!(share(&stats.sources, "other"), Some(1));
    assert_eq!(share(&stats.origins, "stream"), Some(4));
    assert_eq!(share(&stats.origins, "cache"), Some(1));
    assert_eq!(stats.top.playlists[0].id, "likes");
}

#[test]
fn sessions_add_up_real_time() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 100_000, "complete", json!({}));
    play(&conn, "b", "s1", JULY + 200_000, 100_000, "complete", json!({}));
    play(&conn, "a", "s2", JULY + DAY, 40_000, "next", json!({}));
    let stats = overview(&conn, all("2026-07-05")).unwrap();
    assert_eq!(stats.sessions.count, 2);
    assert_eq!(stats.sessions.longest_ms, 200_000);
    assert_eq!(stats.sessions.longest_tracks, 2);
    assert_eq!(stats.sessions.average_ms, 120_000);
}

#[test]
fn a_replay_is_the_same_song_again_in_one_session() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 60_000, "next", json!({}));
    play(&conn, "a", "s1", JULY + 70_000, 60_000, "next", json!({}));
    play(&conn, "a", "s2", JULY + DAY, 60_000, "next", json!({}));
    let stats = overview(&conn, all("2026-07-02")).unwrap();
    assert_eq!(stats.most_replayed[0].replays, Some(1));
    assert_eq!(stats.on_repeat[0].plays, 3);
}

#[test]
fn most_skipped_needs_two_skips_and_forgotten_needs_a_long_silence() {
    let (_dir, conn) = open();
    for index in 0..6 {
        play(&conn, "loved", &format!("old{index}"), JULY - 100 * DAY + index, 200_000, "complete", json!({}));
    }
    play(&conn, "once", "x", JULY, 2_000, "skip", json!({}));
    play(&conn, "twice", "y", JULY, 2_000, "skip", json!({}));
    play(&conn, "twice", "z", JULY + 1, 2_000, "skip", json!({}));
    let stats = overview(&conn, period("2026-07-01", "2026-07-01", "2026-07-01")).unwrap();
    assert_eq!(stats.most_skipped.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["twice"]);
    assert_eq!(stats.forgotten[0].id, "loved");
    assert_eq!(stats.forgotten[0].plays, 6);
    assert!(stats.forgotten[0].last_played_at.is_some());
}

#[test]
fn genres_come_from_the_tags_of_local_files() {
    let (_dir, conn) = open();
    let mut snapshot = track("local:0123456789abcdef0123456789abcdef", "Band");
    snapshot["local"] = json!({"genre": "Ambient"});
    let id = "local:0123456789abcdef0123456789abcdef";
    play(&conn, id, "s1", JULY, 60_000, "next", json!({"trackSnapshot": snapshot}));
    let stats = overview(&conn, all("2026-07-01")).unwrap();
    assert_eq!(stats.top.genres[0].title, "Ambient");
    assert_eq!(stats.top.genres[0].plays, 1);
}

#[test]
fn an_empty_store_gives_a_quiet_answer() {
    let (_dir, conn) = open();
    let stats = overview(&conn, all("2026-07-01")).unwrap();
    assert_eq!(stats.totals.plays, 0);
    assert_eq!(stats.range.from, None);
    assert_eq!(stats.first_played_at, None);
    assert_eq!(stats.by_hour.len(), 24);
}

#[test]
fn a_track_and_an_artist_have_their_whole_history() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY - 40 * DAY, 200_000, "complete", json!({"context": {"type": "playlist", "id": "p"}}));
    play(&conn, "a", "s2", JULY, 60_000, "next", json!({}));
    play(&conn, "a", "s3", JULY + DAY, 3_000, "skip", json!({}));
    play(&conn, "b", "s4", JULY + DAY, 60_000, "next", json!({}));
    keys(&conn);
    let detail = listening::track_detail(&conn, "a").unwrap();
    assert_eq!((detail.plays, detail.skips, detail.completed, detail.active_days), (2, 1, 1, 2));
    assert_eq!(detail.listened_ms, 263_000);
    assert_eq!(detail.by_month.iter().map(|m| (m.month.as_str(), m.plays)).collect::<Vec<_>>(), [("2026-05", 1), ("2026-07", 1)]);
    assert_eq!(detail.first_played_at.as_deref(), Some("2026-05-22T00:00:00.000Z"));
    assert_eq!(detail.track.as_ref().unwrap()["id"], "a");
    let artist = listening::artist_detail(&conn, "band").unwrap();
    assert_eq!(artist.plays, 3);
    assert_eq!(artist.title, "Band");
    assert_eq!(artist.open_id.as_deref(), Some("ar-Band"));
    assert_eq!(artist.top_tracks.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    assert!(listening::track_detail(&conn, "nope").is_err());
    assert!(listening::artist_detail(&conn, "nobody").is_err());
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn delete_removes_a_local_date_range_and_what_only_it_left_behind() {
    let (_dir, conn) = open();
    let july2 = JULY + DAY;
    // 22:30 UTC on the 1st is already the 2nd in UTC+3
    play(&conn, "gone", "s1", JULY + 22 * HOUR + 1_800_000, 60_000, "next", json!({"tzOffsetMin": -180}));
    play(&conn, "kept", "s1", JULY + 22 * HOUR + 1_800_000, 60_000, "next", json!({"tzOffsetMin": 0}));
    play(&conn, "liked", "s2", july2 + 1000, 60_000, "next", json!({}));
    conn.execute("INSERT INTO liked_tracks (track_id, liked_at) VALUES ('liked', 1)", []).unwrap();
    conn.execute(
        "INSERT INTO scrobble_queue (artist, track, played_at) VALUES ('Band', 'gone', ?1), ('Band', 'kept', ?2)",
        params![(JULY + 22 * HOUR + 1_800_000) / 1000 , (JULY + 3 * DAY) / 1000],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO suppressions (scope, key, w0, track_id, origin, created_at) VALUES ('work', 'k', 1, NULL, 'scrub_skip', ?1), ('work', 'k2', 1, NULL, 'user', ?1)",
        params![july2 + 1000],
    )
    .unwrap();
    keys(&conn);
    let removed = listening::delete(&conn, Some((day("2026-07-02"), day("2026-07-02")))).unwrap();
    assert_eq!(removed, 2);
    assert_eq!(count(&conn, "SELECT count(*) FROM play_events"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM play_events WHERE track_id = 'kept'"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM tracks WHERE id = 'gone'"), 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM track_keys WHERE track_id = 'gone'"), 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM tracks WHERE id = 'liked'"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM suppressions"), 1);
    assert_eq!(overview(&conn, all("2026-07-10")).unwrap().totals.plays, 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM scrobble_queue WHERE track = 'kept'"), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM scrobble_queue WHERE track = 'gone'"), 0);
}

#[test]
fn delete_everything_also_forgets_the_learned_weights() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 60_000, "next", json!({}));
    conn.execute("INSERT INTO rec_model (key, weights_json, events_seen, updated_at) VALUES ('m', '[]', 1, 1)", []).unwrap();
    assert_eq!(listening::delete(&conn, None).unwrap(), 1);
    assert_eq!(count(&conn, "SELECT count(*) FROM play_events"), 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM rec_model"), 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM tracks"), 0);
}

#[test]
fn a_paused_collection_stores_no_play() {
    let (_dir, conn) = open();
    listening::set_collection_paused(&conn, true).unwrap();
    play(&conn, "a", "s1", JULY, 60_000, "next", json!({}));
    assert_eq!(count(&conn, "SELECT count(*) FROM play_events"), 0);
    listening::set_collection_paused(&conn, false).unwrap();
    play(&conn, "a", "s1", JULY, 60_000, "next", json!({}));
    assert_eq!(count(&conn, "SELECT count(*) FROM play_events"), 1);
}

#[test]
fn export_lists_the_range_oldest_first() {
    let (_dir, conn) = open();
    play(&conn, "b", "s2", JULY + DAY, 60_000, "next", json!({}));
    play(&conn, "a", "s1", JULY, 60_000, "next", json!({}));
    let rows = listening::export_events(&conn, None).unwrap();
    assert_eq!(rows.iter().map(|e| e.track_id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    assert_eq!(listening::export_events(&conn, Some((day("2026-07-02"), day("2026-07-02")))).unwrap().len(), 1);
    assert_eq!(rows[0].title, "Title a");
}

#[test]
fn migration_21_fills_the_offset_from_the_stored_hour_and_the_source_from_the_track() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    {
        let conn = open_connection(&path, &KEY, &backups).unwrap();
        tracks::upsert(&conn, &track("a", "Band"), JULY).unwrap();
        conn.execute_batch(common::UNDO_STATS_MIGRATION).unwrap();
        conn.pragma_update(None, "user_version", 20).unwrap();
        // 23:30 UTC stored as 02:30 local: UTC+3; 10:00 UTC stored as 02:00: UTC-8
        let insert = "INSERT INTO play_events (track_id, session_id, started_at, played_ms, end_reason, hour, weekday) VALUES ('a', ?1, ?2, 60000, 'next', ?3, 4)";
        conn.execute(insert, params!["s1", JULY + 23 * HOUR + 1_800_000, 2]).unwrap();
        conn.execute(insert, params!["s2", JULY + 10 * HOUR, 2]).unwrap();
    }
    let conn = open_connection(&path, &KEY, &backups).unwrap();
    let mut stmt = conn.prepare("SELECT started_at, tz_offset_min, source FROM play_events ORDER BY session_id").unwrap();
    let rows: Vec<(i64, i64, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect();
    assert_eq!((rows[0].1, rows[1].1), (-180, 480));
    assert_eq!(rows[0].2, "youtube");
    assert_eq!(iso_day(local_day(rows[0].0, rows[0].1)), "2026-07-02");
    assert_eq!(iso_day(local_day(rows[1].0, rows[1].1)), "2026-07-01");
}

fn fixture(conn: &Connection, events: i64) {
    let tx = conn.unchecked_transaction().unwrap();
    let mut seed: u64 = 0x2545_f491_4f6c_dd1d;
    let mut next = move |limit: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % limit
    };
    for index in 0..8000 {
        let id = format!("vid{index:08}");
        let artist = format!("Artist {}", index % 600);
        let mut snapshot = track(&id, &artist);
        snapshot["title"] = json!(format!("A song with a fairly ordinary title number {index}"));
        tracks::upsert(&tx, &snapshot, JULY).unwrap();
        tx.execute(
            "INSERT INTO track_keys (track_id, work_key, artist_key, computed_at) VALUES (?1, ?1, ?2, ?3)",
            params![id, artist.to_lowercase(), JULY + DAY],
        )
        .unwrap();
    }
    let mut insert = tx
        .prepare(
            "INSERT INTO play_events (track_id, session_id, started_at, played_ms, duration_ms, end_reason, context, context_id, position_in_session,
                                      hour, weekday, loop_count, seek_back, tz_offset_min, source)
             VALUES (?1, ?2, ?3, ?4, 210000, ?5, ?6, ?7, ?8, ?9, ?10, 0, 0, ?11, 'youtube')",
        )
        .unwrap();
    let span = 2000 * DAY;
    let step = span / events;
    for index in 0..events {
        let at = JULY - span + index * step + next(60_000) as i64;
        let track_index = (next(8000) * next(8000) / 8000) as usize;
        let session = format!("{:08x}-0000-4000-8000-{:012x}", index / 12, index / 12);
        let tz = if (at / DAY / 180) % 2 == 0 { -120 } else { -180 };
        let (hour, weekday) = nuvo_contracts::local_hour_weekday(at, tz);
        let roll = next(100);
        let (played, reason) = match roll {
            0..=69 => (200_000, "complete"),
            70..=84 => (5_000 + next(20_000) as i64, "skip"),
            _ => (60_000, "next"),
        };
        insert
            .execute(params![
                format!("vid{track_index:08}"),
                session,
                at,
                played,
                reason,
                "playlist",
                format!("pl{}", index % 40),
                index % 12,
                hour,
                weekday,
                tz
            ])
            .unwrap();
    }
    drop(insert);
    tx.commit().unwrap();
}

#[test]
fn the_page_stays_fast_at_200_000_events() {
    let (_dir, conn) = open();
    fixture(&conn, 200_000);
    let cases = [
        ("week", period("2026-06-24", "2026-06-30", "2026-06-30")),
        ("month", period("2026-06-01", "2026-06-30", "2026-06-30")),
        ("year", period("2025-07-01", "2026-06-30", "2026-06-30")),
        ("all", all("2026-06-30")),
    ];
    let mut history = History::default();
    for (name, range) in cases {
        let first = Instant::now();
        let stats = listening::overview(&conn, &mut History::default(), range).unwrap();
        let first = first.elapsed();
        listening::overview(&conn, &mut history, range).unwrap();
        let again = Instant::now();
        listening::overview(&conn, &mut history, range).unwrap();
        let again = again.elapsed();
        let size = serde_json::to_string(&stats).unwrap().len();
        println!("{name}: first {first:?}, again {again:?}, {} plays, {} KB", stats.totals.plays, size / 1024);
        assert!(stats.totals.plays > 0);
        if !cfg!(debug_assertions) {
            assert!(again.as_millis() < 30, "{name} took {again:?}");
        }
    }
}


#[test]
fn context_plays_count_per_list_with_the_last_play() {
    let (_dir, conn) = open();
    play(&conn, "a", "s1", JULY, 200_000, "complete", json!({"context": {"type": "album", "id": "x"}}));
    play(&conn, "b", "s1", JULY + HOUR, 40_000, "next", json!({"context": {"type": "album", "id": "x"}}));
    play(&conn, "c", "s1", JULY + 2 * HOUR, 5_000, "skip", json!({"context": {"type": "album", "id": "x"}}));
    play(&conn, "d", "s1", JULY + 3 * HOUR, 200_000, "complete", json!({"context": {"type": "radio", "id": "a"}}));
    play(&conn, "e", "s1", JULY + 4 * HOUR, 200_000, "complete", json!({"context": {"type": "playlist", "id": "likes"}}));
    let mut rows = listening::context_plays(&conn).unwrap();
    rows.sort_by(|a, b| a.kind.cmp(&b.kind));
    assert_eq!(rows.len(), 2);
    assert_eq!((rows[0].kind.as_str(), rows[0].id.as_str(), rows[0].plays), ("album", "x", 2));
    assert_eq!(rows[0].last_played_at, nuvo_contracts::iso_from_ms(JULY + HOUR));
    assert_eq!((rows[1].kind.as_str(), rows[1].id.as_str(), rows[1].plays), ("playlist", "likes", 1));
}
