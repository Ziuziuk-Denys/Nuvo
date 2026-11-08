mod common;

use common::{DAY, NOW, play, track};
use nuvo_recs::keys::{self, TrackKey};
use nuvo_recs::suppress::{self, Suppressions};
use serde_json::json;

fn key(conn: &nuvo_store::Connection, id: &str) -> TrackKey {
    keys::refresh(conn).unwrap();
    keys::load(conn, &[id.to_string()]).unwrap().remove(id).unwrap()
}

fn penalty(conn: &nuvo_store::Connection, id: &str, now: i64) -> Option<f64> {
    let k = key(conn, id);
    Suppressions::load(conn, now).unwrap().penalty(id, &k)
}

#[test]
fn scopes_decay_and_resolve_in_order() {
    let (_dir, conn) = common::open();
    track(&conn, "orig", "Song", "Artist");
    track(&conn, "remix", "Song (DJ Remix)", "Artist");
    track(&conn, "live", "Song (Live)", "Artist");
    track(&conn, "cover", "Song", "Somebody");
    track(&conn, "other", "Different", "Artist");
    track(&conn, "gone", "Gone", "Elsewhere");

    suppress::not_interested(&conn, "gone", "exact", NOW).unwrap();
    assert_eq!(penalty(&conn, "gone", NOW), None, "exact removes outright");

    suppress::not_interested(&conn, "orig", "work", NOW).unwrap();
    let dislike_artist = 0.3;
    assert!((penalty(&conn, "live", NOW).unwrap() - (1.0 + dislike_artist)).abs() < 1e-9, "any version of the work, plus the artist share");
    assert!((penalty(&conn, "cover", NOW).unwrap() - 0.5).abs() < 1e-9, "a cover by someone else at half weight");
    assert!((penalty(&conn, "other", NOW).unwrap() - dislike_artist).abs() < 1e-9, "only the artist share");
    let half = penalty(&conn, "live", NOW + 180 * DAY).unwrap();
    assert!((half - (0.5 + 0.3 * 2f64.powi(-6))).abs() < 1e-9, "work half-life 180 d, artist share 30 d: {half}");

    nuvo_store::library::like(&conn, "remix", None, NOW).unwrap();
    assert_eq!(penalty(&conn, "remix", NOW), Some(0.0), "a liked remix survives the work suppression");
    track(&conn, "remix-reupload", "Artist - Song [DJ Remix]", "Artist");
    assert_eq!(penalty(&conn, "remix-reupload", NOW), Some(0.0), "so does another upload of the same remix");

    suppress::not_interested(&conn, "other", "artist_forever", NOW).unwrap();
    assert!(penalty(&conn, "remix", NOW).unwrap() >= suppress::FOREVER_W0, "a permanent artist block wins over likes");
    assert!(penalty(&conn, "other", NOW + 3650 * DAY).unwrap() >= suppress::FOREVER_W0, "and never fades");
}

#[test]
fn repeated_dislikes_offer_to_hide_the_artist() {
    let (_dir, conn) = common::open();
    for i in 0..5 {
        track(&conn, &format!("t{i}"), &format!("Song {i}"), "Artist");
    }
    let offers: Vec<bool> = (0..4).map(|i| suppress::not_interested(&conn, &format!("t{i}"), "work", NOW).unwrap().offer_hide_artist).collect();
    assert_eq!(offers, [false, false, false, true], "0.3 per dislike reaches 1.0 on the fourth");
    let after_block = suppress::not_interested(&conn, "t4", "artist_forever", NOW).unwrap();
    assert!(!after_block.offer_hide_artist, "never offered again once blocked");
}

#[test]
fn bad_requests_are_refused() {
    let (_dir, conn) = common::open();
    track(&conn, "a", "Song", "Artist");
    assert!(matches!(suppress::not_interested(&conn, "a", "album", NOW), Err(nuvo_store::StoreError::Invalid(_))));
    assert!(matches!(suppress::not_interested(&conn, "nope", "work", NOW), Err(nuvo_store::StoreError::NotFound(_))));
    assert!(matches!(suppress::delete(&conn, 42), Err(nuvo_store::StoreError::NotFound(_))));
}

#[test]
fn blocklist_shows_penalty_and_fade_date_and_undo_restores() {
    let (_dir, conn) = common::open();
    track(&conn, "a", "Song", "Artist");
    track(&conn, "b", "Other", "Band");
    let work = suppress::not_interested(&conn, "a", "work", NOW).unwrap().suppression_id;
    suppress::not_interested(&conn, "b", "artist_forever", NOW + 1).unwrap();
    let list = suppress::list(&conn, NOW).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!((list[0].scope.as_str(), list[0].fades_at.as_deref()), ("artist_forever", None));
    assert_eq!(list[1].scope, "work");
    assert_eq!(list[1].track.as_ref().unwrap()["id"], "a");
    assert!((list[1].penalty - 1.0).abs() < 1e-9);
    // 1.0 -> 0.05 takes log2(20) half-lives of 180 days, about 778 days.
    let fades = (180.0 * 86_400_000.0 * 20f64.log2()) as i64;
    assert_eq!(list[1].fades_at.as_deref(), Some(nuvo_contracts::iso_from_ms(NOW + fades).as_str()));

    suppress::delete(&conn, work).unwrap();
    assert_eq!(penalty(&conn, "a", NOW), Some(0.0), "undo restores at once");
    assert_eq!(suppress::list(&conn, NOW + 4000 * DAY).unwrap().len(), 1, "only the permanent block is left");
}

#[test]
fn plays_feed_automatic_suppressions() {
    let (_dir, conn) = common::open();
    let scrubbed = json!({"completed": false, "endReason": "skip", "playedDurationMs": 80000, "seekForwardMs": 60000, "startedAt": NOW});
    play(&conn, "a", "Artist", "s1", NOW, scrubbed.clone());
    let event: nuvo_contracts::RecordPlaybackEvent = serde_json::from_value(json!({
        "listeningSessionId": "s1", "trackId": "a", "playedDurationMs": 80000, "completed": false,
        "endReason": "skip", "seekForwardMs": 60000, "startedAt": NOW
    }))
    .unwrap();
    suppress::after_play(&conn, &event, NOW).unwrap();
    suppress::after_play(&conn, &event, NOW).unwrap();
    let list = suppress::list(&conn, NOW).unwrap();
    assert_eq!(list.len(), 1, "a re-sent event adds nothing");
    assert_eq!((list[0].scope.as_str(), list[0].origin.as_str()), ("work", "scrub_skip"));
    assert!((penalty(&conn, "a", NOW).unwrap() - 0.3).abs() < 1e-9, "weak: w0 0.3, no artist share");

    let chosen: nuvo_contracts::RecordPlaybackEvent = serde_json::from_value(json!({
        "listeningSessionId": "s2", "trackId": "a", "playedDurationMs": 200000, "completed": true,
        "context": {"type": "playlist", "id": "p"}, "startedAt": NOW + 1000
    }))
    .unwrap();
    suppress::after_play(&conn, &chosen, NOW).unwrap();
    assert!((penalty(&conn, "a", NOW).unwrap() - 0.15).abs() < 1e-9, "a full play from a playlist halves it");
}

#[test]
fn tracks_without_an_artist_share_no_artist_penalty() {
    let (_dir, conn) = common::open();
    track(&conn, "u1", "Untitled one", "?");
    track(&conn, "u2", "Untitled two", "?");
    suppress::not_interested(&conn, "u1", "exact", NOW).unwrap();
    assert_eq!(penalty(&conn, "u2", NOW), Some(0.0), "a dislike of one artistless track spares the others");
    assert!(suppress::not_interested(&conn, "u2", "artist_forever", NOW).is_err(), "no artist to block");
    assert_eq!(penalty(&conn, "u2", NOW), Some(0.0));
}
