mod common;

use common::{DAY, NOW, play, snapshot, track};
use nuvo_recs::{features, pmi, pool};
use serde_json::json;

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn npmi_is_normalised() {
    assert_eq!(pmi::npmi(0.0, 1.0, 1.0, 10.0), 0.0);
    assert!((pmi::npmi(1.0, 1.0, 1.0, 10.0) - 1.0).abs() < 1e-9, "only ever together");
    assert!((pmi::npmi(1.0, 1.0, 5.0, 10.0) - 2f64.ln() / 10f64.ln()).abs() < 1e-9, "a common track is less telling");
    assert_eq!(pmi::npmi(1.0, 10.0, 10.0, 10.0), 0.0, "independent");
}

#[test]
fn co_occurrence_from_candidate_lists_and_sessions() {
    let (_dir, conn) = common::open();
    pool::replace(&conn, "s1", "radio", &[snapshot("a", "A", "X"), snapshot("b", "B", "X")], NOW).unwrap();
    pool::replace(&conn, "s2", "radio", &[snapshot("a", "A", "X"), snapshot("c", "C", "X")], NOW).unwrap();
    pool::replace(&conn, "s3", "radio", &[snapshot("d", "D", "X"), snapshot("e", "E", "X")], NOW).unwrap();
    let p = pmi::compute(&conn, &ids(&["s1"]), &ids(&["a", "b", "c", "d"])).unwrap();
    assert!((p.get("s1", "b") - 1.0).abs() < 1e-9);
    assert!((p.get("s1", "a") - (1.5f64.ln() / 3f64.ln())).abs() < 1e-9, "a is in two lists");
    assert_eq!((p.get("s1", "c"), p.get("s1", "d")), (0.0, 0.0));

    for (i, id) in ["q", "w", "e2", "r", "t"].iter().enumerate() {
        play(&conn, id, "Y", "sess", NOW + i as i64, json!({}));
    }
    play(&conn, "skipped", "Y", "sess", NOW + 10, common::skip(1000));
    let p = pmi::compute(&conn, &ids(&["q"]), &ids(&["w", "e2", "r", "t", "skipped"])).unwrap();
    assert!(p.get("q", "w") > 0.0 && p.get("q", "r") > 0.0, "within 3 positions");
    assert_eq!(p.get("q", "t"), 0.0, "4 positions away");
    assert_eq!(p.get("q", "skipped"), 0.0, "a skip is not a counted play");
}

#[test]
fn pool_replace_and_stale_seeds() {
    let (_dir, conn) = common::open();
    track(&conn, "loved", "Loved", "X");
    nuvo_store::library::like(&conn, "loved", None, NOW).unwrap();
    play(&conn, "played", "Y", "s", NOW - DAY, json!({}));
    play(&conn, "old", "Y", "s", NOW - 40 * DAY, json!({}));
    let mut seeds = pool::stale_seeds(&conn, NOW, "radio").unwrap();
    assert_eq!(seeds, ["loved", "played"], "liked first; plays older than 30 days do not count");

    let items = [snapshot("loved", "Loved", "X"), snapshot("n1", "N1", "Z"), snapshot("n1", "N1", "Z"), snapshot("n2", "N2", "Z")];
    assert_eq!(pool::replace(&conn, "loved", "radio", &items, NOW).unwrap(), 2, "the seed and repeats are skipped");
    seeds = pool::stale_seeds(&conn, NOW, "radio").unwrap();
    assert_eq!(seeds, ["played"]);
    assert_eq!(pool::stale_seeds(&conn, NOW + 25 * 3_600_000, "radio").unwrap(), ["loved", "played"], "stale again after 24 h");
    assert_eq!(pool::replace(&conn, "loved", "radio", &[snapshot("n3", "N3", "Z")], NOW).unwrap(), 1);
    let left: i64 = conn.query_row("SELECT count(*) FROM candidate_edges WHERE seed_id = 'loved'", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 1, "replace drops the old list");

    let too_many: Vec<_> = (0..101).map(|i| snapshot(&format!("x{i}"), "X", "Z")).collect();
    assert!(pool::replace(&conn, "loved", "radio", &too_many, NOW).is_err());
    assert!(pool::replace(&conn, "", "radio", &[], NOW).is_err());
    assert!(pool::replace(&conn, "loved", "radio", &[json!({"title": "no id"})], NOW).is_err());
}

#[test]
fn audio_vectors_are_optional() {
    let (_dir, conn) = common::open();
    features::store(&conn, "a", 1, &[0.0, 0.5, -0.5], NOW).unwrap();
    features::store(&conn, "b", 1, &[0.0, 0.5, 0.5], NOW).unwrap();
    features::store(&conn, "short", 1, &[0.0], NOW).unwrap();
    let v = features::load(&conn, &ids(&["a", "b", "short", "none"])).unwrap();
    assert_eq!(v["a"], [0.0, 0.5, -0.5]);
    assert_eq!(features::distance(v.get("a"), v.get("b")), Some(1.0));
    assert_eq!(features::similarity(v.get("a"), v.get("b")), 0.5);
    assert_eq!(features::distance(v.get("a"), v.get("short")), None, "different layouts never compare");
    assert_eq!(features::similarity(v.get("a"), v.get("none")), 0.0, "no vector, no evidence");
}

#[test]
fn stale_seeds_ignores_ranked_edges() {
    let (_dir, conn) = common::open();
    track(&conn, "seed1", "Seed1", "X");
    nuvo_store::library::like(&conn, "seed1", None, NOW).unwrap();
    pool::record(&conn, "seed1", &ids(&["a", "b", "c"]), NOW).unwrap();
    let seeds = pool::stale_seeds(&conn, NOW, "radio").unwrap();
    assert_eq!(seeds, ["seed1"], "seed with only rank source edges counts as stale");
}

#[test]
fn replace_returns_zero_for_empty_items() {
    let (_dir, conn) = common::open();
    assert_eq!(pool::replace(&conn, "seed1", "radio", &[], NOW).unwrap(), 0, "empty items returns 0 without deleting");
    let count: i64 = conn.query_row("SELECT count(*) FROM candidate_edges WHERE seed_id = 'seed1'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0, "no rows created or deleted");
}

#[test]
fn store_rejects_non_finite_values() {
    let (_dir, conn) = common::open();
    assert!(features::store(&conn, "a", 1, &[f32::NAN], NOW).is_err(), "NaN rejected");
    assert!(features::store(&conn, "a", 1, &[f32::INFINITY], NOW).is_err(), "infinity rejected");
    assert!(features::store(&conn, "a", 1, &[f32::NEG_INFINITY], NOW).is_err(), "negative infinity rejected");
    assert!(features::store(&conn, "a", 1, &[0.0, 1.0, f32::NAN], NOW).is_err(), "NaN in middle rejected");
}

#[test]
fn freshness_is_per_source_and_a_miss_rests_a_week() {
    let (_dir, conn) = common::open();
    track(&conn, "loved", "Loved", "X");
    nuvo_store::library::like(&conn, "loved", None, NOW).unwrap();
    track(&conn, "sc:7", "Cloud", "Y");
    nuvo_store::library::like(&conn, "sc:7", None, NOW).unwrap();
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::YT_RADIO).unwrap(), ["loved"], "the YouTube radio cannot start from a SoundCloud track");
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::SC_RELATED).unwrap(), ["loved", "sc:7"]);

    pool::replace(&conn, "loved", pool::SC_RELATED, &[snapshot("sc:1", "One", "Z")], NOW).unwrap();
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::YT_RADIO).unwrap(), ["loved"], "a SoundCloud list leaves the YouTube radio due");
    pool::replace(&conn, "loved", pool::YT_RADIO, &[snapshot("y1", "Y1", "Z")], NOW).unwrap();
    let edges: Vec<(String, String)> = conn
        .prepare("SELECT track_id, source FROM candidate_edges WHERE seed_id = 'loved' ORDER BY track_id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(edges, [("sc:1".to_string(), "sc_related".to_string()), ("y1".to_string(), "yt_radio".to_string())], "each source replaces only its own list");

    assert_eq!(pool::replace(&conn, "sc:7", pool::SC_RELATED, &[], NOW).unwrap(), 0, "an empty fetch is noted");
    assert_eq!(pool::stale_seeds(&conn, NOW + 2 * DAY, pool::SC_RELATED).unwrap(), ["loved"], "a list is stale after a day, a miss rests");
    assert_eq!(pool::stale_seeds(&conn, NOW + 8 * DAY, pool::SC_RELATED).unwrap(), ["loved", "sc:7"], "and is tried again after a week");
    assert!(pool::stale_seeds(&conn, NOW, "").is_err());
}

#[test]
fn lists_stored_under_the_old_source_names_are_current_after_the_upgrade() {
    let (dir, conn) = common::open();
    track(&conn, "old1", "Old one", "X");
    track(&conn, "old2", "Old two", "Y");
    nuvo_store::library::like(&conn, "old1", None, NOW).unwrap();
    nuvo_store::library::like(&conn, "old2", None, NOW).unwrap();
    pool::replace(&conn, "old1", "youtube-radio", &[snapshot("a", "A", "Z"), snapshot("b", "B", "Z")], NOW).unwrap();
    pool::replace(&conn, "old2", "soundcloud-radio", &[snapshot("sc:9", "C", "Z")], NOW).unwrap();
    // Back to the database a version 15 build left: old names, no fetch notes.
    conn.execute_batch(&format!("DROP INDEX play_events_started; ALTER TABLE play_events DROP COLUMN tz_offset_min; ALTER TABLE play_events DROP COLUMN source; DROP TABLE pool_fetches; DROP TABLE rec_starters; UPDATE candidate_edges SET fetched_at = {NOW}; PRAGMA user_version = 15;")).unwrap();
    drop(conn);

    let conn = nuvo_store::open_connection(&dir.path().join("library.db"), &[7u8; 32], &dir.path().join("backups")).unwrap();
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::YT_RADIO).unwrap(), ["old2"], "only the SoundCloud-listed seed still wants a YouTube radio");
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::SC_RELATED).unwrap(), ["old1"], "and only the YouTube-listed seed still wants SoundCloud related");

    assert_eq!(pool::replace(&conn, "old1", pool::YT_RADIO, &[snapshot("c", "C2", "Z")], NOW + 1).unwrap(), 1);
    let left: i64 = conn.query_row("SELECT count(*) FROM candidate_edges WHERE seed_id = 'old1'", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 1, "the new list replaced the old one instead of sitting beside it");
}

#[test]
fn a_list_that_only_overlaps_other_edges_still_counts_as_stored() {
    let (_dir, conn) = common::open();
    track(&conn, "seed", "Seed", "X");
    nuvo_store::library::like(&conn, "seed", None, NOW).unwrap();
    let list = [snapshot("a", "A", "Z"), snapshot("b", "B", "Z")];
    pool::replace(&conn, "seed", pool::SC_RELATED, &list, NOW).unwrap();
    assert_eq!(pool::replace(&conn, "seed", pool::YT_RADIO, &list, NOW).unwrap(), 2, "tracks another list already holds are stored too");
    assert!(!pool::stale_seeds(&conn, NOW + 1, pool::YT_RADIO).unwrap().contains(&"seed".to_string()), "not a miss that rests a week, and not due again");
    assert_eq!(pool::stale_seeds(&conn, NOW + 2 * DAY, pool::YT_RADIO).unwrap(), ["seed"], "it is stale after a day, not after a week");
}
