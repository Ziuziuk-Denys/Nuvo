mod common;

use std::collections::HashSet;

use common::{DAY, NOW, play, skip, snapshot, track};
use nuvo_contracts::{RankRequest, RankResponse, RankSignals};
use nuvo_recs::{features, pool, rank, suppress};
use nuvo_store::Connection;
use serde_json::{Value, json};

fn know(conn: &Connection, artists: &[&str]) {
    for (i, artist) in artists.iter().enumerate() {
        for n in 0..3 {
            play(conn, &format!("filler-{artist}"), artist, "history", NOW - 300 * DAY + (i * 10 + n) as i64, json!({}));
        }
    }
}

fn candidates(artists: &[&str], per_artist: usize) -> Vec<Value> {
    (0..per_artist).flat_map(|n| artists.iter().map(move |a| snapshot(&format!("{a}-{n}"), &format!("{a} song {n}"), a))).collect()
}

fn request(context: &str, seeds: &[&str], candidates: Vec<Value>) -> RankRequest {
    RankRequest {
        context: context.into(),
        seeds: seeds.iter().map(|s| s.to_string()).collect(),
        candidates,
        ..Default::default()
    }
}

fn ids(response: &RankResponse) -> Vec<String> {
    response.items.iter().map(|i| i.track["id"].as_str().unwrap().to_string()).collect()
}

fn artist_of(id: &str) -> &str {
    id.split('-').next().unwrap()
}

const TEN: [&str; 10] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

#[test]
fn batches_of_ten_are_recorded() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    track(&conn, "seed", "Seed", "z");
    let res = rank::rank(&conn, &request("radio:seed", &["seed"], candidates(&TEN, 4)), NOW, 1).unwrap();
    assert_eq!(res.items.len(), 10);
    assert_eq!(res.batch_id.len(), 36);
    assert_eq!(res.dropped, 0);
    let served: i64 = conn.query_row("SELECT count(*) FROM served WHERE batch_id = ?1 AND context = 'radio:seed'", [&res.batch_id], |r| r.get(0)).unwrap();
    assert_eq!(served, 10);
    let edges: i64 = conn.query_row("SELECT count(*) FROM candidate_edges WHERE seed_id = 'seed'", [], |r| r.get(0)).unwrap();
    assert_eq!(edges, 40, "a single-seed request keeps its candidates as similarity evidence");
    let reason = &res.items[0].reason;
    assert!(["artist", "similar", "new", "time", "session"].contains(&reason.kind));
}

#[test]
fn session_feedback_moves_neighbours() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    pool::replace(&conn, "good", "radio", &[snapshot("h-pal", "Pal of good", "h")], NOW - DAY).unwrap();
    pool::replace(&conn, "bad", "radio", &[snapshot("i-pal", "Pal of bad", "i")], NOW - DAY).unwrap();
    play(&conn, "good", "g", "live", NOW - 60_000, json!({}));
    play(&conn, "bad", "b", "live", NOW - 30_000, skip(1000));
    let mut list = candidates(&TEN, 1);
    list.push(snapshot("h-pal", "Pal of good", "h"));
    list.push(snapshot("i-pal", "Pal of bad", "i"));
    list.extend(candidates(&TEN, 2).split_off(10));

    let mut cold = request("radio:x", &[], list.clone());
    cold.limit = Some(22);
    let mut warm = request("radio:y", &[], list);
    warm.limit = Some(22);
    warm.session_id = Some("live".into());
    let before = ids(&rank::rank(&conn, &cold, NOW, 7).unwrap());
    let res = rank::rank(&conn, &warm, NOW, 7).unwrap();
    let after = ids(&res);
    let pos = |list: &[String], id: &str| list.iter().position(|x| x == id).unwrap();
    assert!(pos(&after, "h-pal") < pos(&before, "h-pal"), "the finished track's neighbour moves up");
    assert!(pos(&after, "i-pal") > pos(&before, "i-pal"), "the skipped track's neighbour moves down");
    assert!(pos(&after, "b-0") > pos(&before, "b-0"), "so does the skipped track's artist");
    let pal = &res.items[pos(&after, "h-pal")].reason;
    assert_eq!((pal.kind, pal.name.as_deref()), ("session", Some("Song good")));
    assert_eq!(res.signals, RankSignals { liked: 1, skipped: 1, scrubbed: 0 });
}

#[test]
fn refresh_never_repeats_the_last_three_batches() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    let mut seen: Vec<HashSet<String>> = Vec::new();
    for i in 0..4 {
        let res = rank::rank(&conn, &request("suggest:p1", &[], candidates(&TEN, 4)), NOW + i, i as u64).unwrap();
        let batch: HashSet<String> = ids(&res).into_iter().collect();
        assert_eq!(batch.len(), 10);
        for earlier in &seen {
            assert!(batch.is_disjoint(earlier), "batch {i} repeats an earlier one");
        }
        seen.push(batch);
    }
    let fifth: HashSet<String> = ids(&rank::rank(&conn, &request("suggest:p1", &[], candidates(&TEN, 4)), NOW + 9, 9).unwrap()).into_iter().collect();
    assert_eq!(fifth, seen[0], "after three batches the first one may come back; music never runs out");
}

#[test]
fn signals_count_the_session() {
    let (_dir, conn) = common::open();
    play(&conn, "f1", "x", "s", NOW - 6000, json!({}));
    play(&conn, "f2", "x", "s", NOW - 5000, json!({}));
    play(&conn, "k1", "x", "s", NOW - 4000, skip(2000));
    play(&conn, "k2", "x", "s", NOW - 3000, json!({"completed": false, "endReason": "next", "playedDurationMs": 500}));
    play(&conn, "sc", "x", "s", NOW - 2000, json!({"completed": false, "endReason": "skip", "playedDurationMs": 90000, "seekForwardMs": 50000}));
    play(&conn, "st", "x", "s", NOW - 1000, json!({"completed": false, "endReason": "stop", "playedDurationMs": 500}));
    play(&conn, "other", "x", "elsewhere", NOW - 1000, skip(500));
    let mut req = request("radio:f1", &["f1"], candidates(&["y"], 3));
    assert_eq!(rank::rank(&conn, &req, NOW, 1).unwrap().signals, RankSignals::default(), "no session, no signals");
    req.session_id = Some("s".into());
    assert_eq!(rank::rank(&conn, &req, NOW, 1).unwrap().signals, RankSignals { liked: 2, skipped: 2, scrubbed: 1 });
}

#[test]
fn exploration_takes_one_or_two_of_ten() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    let new_artists = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"];
    let mut list = candidates(&TEN, 2);
    list.extend(candidates(&new_artists, 1));
    let mut total = 0;
    let runs = 40;
    for run in 0..runs {
        let res = rank::rank(&conn, &request(&format!("radio:{run}"), &[], list.clone()), NOW, run).unwrap();
        let explored: Vec<&str> = res.items.iter().filter(|i| i.reason.kind == "new").map(|i| i.track["id"].as_str().unwrap()).collect();
        assert!((1..=2).contains(&explored.len()), "run {run}: {explored:?}");
        assert!(explored.iter().all(|id| id.starts_with('n')), "exploration picks never-played artists");
        total += explored.len();
    }
    let mean = total as f64 / runs as f64;
    assert!((1.25..=1.75).contains(&mean), "15 % of slots on average, got {mean}");
}

#[test]
fn artist_cap_spans_the_previous_batch() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    track(&conn, "a-old1", "Old 1", "a");
    track(&conn, "a-old2", "Old 2", "a");
    let mut req = request("radio:z", &[], candidates(&TEN, 4));
    req.recent = vec!["a-old1".into(), "a-old2".into()];
    let batch = ids(&rank::rank(&conn, &req, NOW, 3).unwrap());
    assert!(batch[..8].iter().all(|id| artist_of(id) != "a"), "two of a just played: none in the next 8: {batch:?}");
    for artist in TEN {
        assert!(batch.iter().filter(|id| artist_of(id) == artist).count() <= 2, "{artist} more than twice: {batch:?}");
    }
}

#[test]
fn a_work_comes_back_only_after_fifty_plays() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    play(&conn, "x-song", "x", "s0", NOW - 10_000, json!({}));
    conn.execute("UPDATE tracks SET title = 'Song' WHERE id = 'x-song'", []).unwrap();
    let mut list = vec![snapshot("x-remix", "Song (Club Remix)", "x"), snapshot("w-thing", "Thing", "w"), snapshot("w-thing2", "Thing (Official Video)", "w")];
    list.extend(candidates(&TEN, 2));
    let mut req = request("radio:q", &[], list);
    req.limit = Some(20);
    let batch = ids(&rank::rank(&conn, &req, NOW, 5).unwrap());
    assert!(!batch.contains(&"x-remix".to_string()), "same work as a recent play");
    assert_eq!(batch.iter().filter(|id| id.starts_with("w-thing")).count(), 1, "two uploads of one work, one pick");
}

#[test]
fn search_starts_near_the_seed() {
    let (_dir, conn) = common::open();
    let artists = ["a", "b", "c", "d", "e", "f", "s", "n", "m"];
    know(&conn, &artists);
    track(&conn, "seed", "Seed", "s");
    pool::replace(&conn, "seed", "radio", &[snapshot("n-1", "Near 1", "n"), snapshot("s-1", "Seed artist 1", "s"), snapshot("s-2", "Seed artist 2", "s"), snapshot("m-1", "Near 2", "m")], NOW - DAY).unwrap();
    let mut list = candidates(&["a", "b", "c", "d", "e", "f"], 2);
    list.extend([snapshot("n-1", "Near 1", "n"), snapshot("s-1", "Seed artist 1", "s"), snapshot("s-2", "Seed artist 2", "s"), snapshot("m-1", "Near 2", "m")]);
    let batch = ids(&rank::rank(&conn, &request("search:seed", &["seed"], list), NOW, 11).unwrap());
    let lead: HashSet<&str> = batch[..3].iter().map(String::as_str).collect();
    assert!(lead.contains("n-1") && lead.contains("m-1"), "neighbours lead: {batch:?}");
    assert_eq!(lead.iter().filter(|id| id.starts_with("s-")).count(), 1, "the seed's artist once: {batch:?}");
}

#[test]
fn suppressed_and_heard_tracks_are_dropped() {
    let (_dir, conn) = common::open();
    track(&conn, "blocked", "Blocked", "x");
    suppress::not_interested(&conn, "blocked", "exact", NOW).unwrap();
    let list = vec![
        snapshot("blocked", "Blocked", "x"),
        snapshot("seed", "Seed", "x"),
        snapshot("heard", "Heard", "x"),
        json!({"title": "no id"}),
        snapshot("ok", "Fine", "y"),
        snapshot("ok", "Fine", "y"),
    ];
    let mut req = request("radio:seed", &["seed"], list);
    req.recent = vec!["heard".into()];
    let res = rank::rank(&conn, &req, NOW, 1).unwrap();
    assert_eq!(ids(&res), ["ok"]);
    assert_eq!(res.dropped, 5);
}

#[test]
fn audio_vectors_are_used_when_present() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    track(&conn, "seed", "Seed", "z");
    let mut list = candidates(&TEN, 2);
    list.push(snapshot("j-close", "Sounds alike", "j"));
    let mut req = request("radio:v1", &["seed"], list.clone());
    req.limit = Some(21);
    let before = ids(&rank::rank(&conn, &req, NOW, 2).unwrap());
    features::store(&conn, "seed", 1, &[0.2, 0.2], NOW).unwrap();
    features::store(&conn, "j-close", 1, &[0.2, 0.25], NOW).unwrap();
    let mut req = request("radio:v2", &["seed"], list);
    req.limit = Some(21);
    let after = ids(&rank::rank(&conn, &req, NOW, 2).unwrap());
    let pos = |list: &[String]| list.iter().position(|x| x == "j-close").unwrap();
    assert!(pos(&after) < pos(&before), "a track that sounds like the seed moves up");
}

#[test]
fn bad_requests_are_refused() {
    let (_dir, conn) = common::open();
    assert!(rank::rank(&conn, &request("", &[], vec![]), NOW, 1).is_err());
    let many: Vec<Value> = (0..501).map(|i| snapshot(&format!("t{i}"), "T", "x")).collect();
    assert!(rank::rank(&conn, &request("radio:x", &[], many), NOW, 1).is_err());
    let empty = rank::rank(&conn, &request("radio:x", &[], vec![]), NOW, 1).unwrap();
    assert!(empty.items.is_empty());
}

#[test]
fn model_falls_back_to_fixed_weights_on_corruption() {
    let (_dir, conn) = common::open();
    conn.execute("INSERT INTO rec_model (key, weights_json, events_seen, updated_at) VALUES (?1, ?2, 500, 0)", ["global", "invalid json"]).unwrap();
    let model = nuvo_recs::model::Model::load(&conn).unwrap();
    assert!(!model.learned, "corrupt weights revert to fixed");
    assert_eq!(model.weights, nuvo_recs::model::FIXED);
}

#[test]
fn fallback_replays_heard_tracks_when_every_candidate_is_dropped() {
    let (_dir, conn) = common::open();
    play(&conn, "older", "x", "session", NOW - 20_000, json!({}));
    play(&conn, "newer", "y", "session", NOW - 10_000, json!({}));
    play(&conn, "skipped", "x", "session", NOW - 9_000, skip(1000));
    play(&conn, "hidden", "x", "session", NOW - 8_000, json!({}));
    play(&conn, "banned", "banned", "session", NOW - 7_000, json!({}));
    suppress::not_interested(&conn, "hidden", "exact", NOW).unwrap();
    suppress::not_interested(&conn, "banned", "artist_forever", NOW).unwrap();
    track(&conn, "ok1", "O1", "x");
    track(&conn, "ok2", "O2", "x");
    suppress::not_interested(&conn, "ok1", "exact", NOW).unwrap();
    suppress::not_interested(&conn, "ok2", "exact", NOW).unwrap();
    let mut req = request("radio:fallback", &[], vec![snapshot("ok1", "O1", "x"), snapshot("ok2", "O2", "x")]);
    req.session_id = Some("session".into());
    let res = rank::rank(&conn, &req, NOW, 1).unwrap();
    assert_eq!(ids(&res), ["older", "newer"], "least recently played first, without skipped, hidden or blocked tracks");
    assert_eq!(res.items[0].track, snapshot("older", "Song older", "x"), "full track items");
    let mut stmt = conn.prepare("SELECT track_id FROM served WHERE batch_id = ?1 ORDER BY track_id").unwrap();
    let served: Vec<String> = stmt.query_map([&res.batch_id], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    assert_eq!(served, ["newer", "older"], "the fallback batch is recorded");
}

#[test]
fn not_interested_holds_across_two_hundred_batches() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    track(&conn, "blk-0", "Blocked song 0", "blk");
    suppress::not_interested(&conn, "blk-0", "artist_forever", NOW).unwrap();
    track(&conn, "hw-song", "Hidden Song", "hw");
    suppress::not_interested(&conn, "hw-song", "work", NOW).unwrap();
    let mut list = candidates(&TEN, 4);
    list.extend((0..4).map(|n| snapshot(&format!("blk-{n}"), &format!("Blocked song {n}"), "blk")));
    list.extend([snapshot("hw-song", "Hidden Song", "hw"), snapshot("hw-live", "Hidden Song (Live)", "hw")]);
    for run in 0..200 {
        let res = rank::rank(&conn, &request(&format!("radio:run{run}"), &[], list.clone()), NOW, run).unwrap();
        let batch = ids(&res);
        assert_eq!(batch.len(), 10);
        assert!(batch.iter().all(|id| !id.starts_with("blk-") && !id.starts_with("hw-")), "run {run}: {batch:?}");
        assert!(res.dropped >= 4, "the blocked artist's tracks are dropped");
    }
}

#[test]
fn a_skipped_track_lifts_nothing_as_a_seed_or_a_recent_play() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    pool::replace(&conn, "bad", "radio", &[snapshot("i-pal", "Pal of bad", "i")], NOW - DAY).unwrap();
    play(&conn, "bad", "b", "live", NOW - 30_000, skip(1000));
    features::store(&conn, "bad", 1, &[0.2, 0.2], NOW).unwrap();
    features::store(&conn, "i-pal", 1, &[0.2, 0.25], NOW).unwrap();
    let mut list = candidates(&TEN, 1);
    list.push(snapshot("i-pal", "Pal of bad", "i"));
    let mut req = request("radio:cold", &["bad"], list);
    req.limit = Some(11);
    req.recent = vec!["bad".into()];
    // Served features of the pal: [3] co-listening similarity, [4] audio similarity.
    let pal_features = |batch: &str| -> Vec<f64> {
        let json: String = conn.query_row("SELECT features_json FROM served WHERE batch_id = ?1 AND track_id = 'i-pal'", [batch], |r| r.get(0)).unwrap();
        serde_json::from_str(&json).unwrap()
    };
    let cold = pal_features(&rank::rank(&conn, &req, NOW, 3).unwrap().batch_id);
    assert!(cold[3] > 0.0 && cold[4] > 0.0, "without the session a seed is evidence: {cold:?}");
    req.context = "radio:warm".into();
    req.session_id = Some("live".into());
    let warm = pal_features(&rank::rank(&conn, &req, NOW, 3).unwrap().batch_id);
    assert_eq!((warm[3], warm[4]), (0.0, 0.0), "a track skipped this session is no anchor");
}

#[test]
fn a_plain_repeat_comes_before_a_hidden_work() {
    let (_dir, conn) = common::open();
    for n in 0..5 {
        let id = format!("hw-old{n}");
        nuvo_store::library::like(&conn, &id, Some(snapshot(&id, &format!("Loved {n}"), "hw")), NOW - 10 * DAY + n).unwrap();
        play(&conn, &format!("r-old{n}"), "r", "history2", NOW - 10 * DAY + 10 + n, skip(1000));
    }
    track(&conn, "hw-song", "Hidden Song", "hw");
    suppress::not_interested(&conn, "hw-song", "work", NOW).unwrap();
    rank::rank(&conn, &request("radio:tier", &[], vec![snapshot("r-1", "Repeat", "r")]), NOW - 1000, 1).unwrap();
    let list = vec![snapshot("a-0", "Fresh", "a"), snapshot("hw-song", "Hidden Song", "hw"), snapshot("r-1", "Repeat", "r")];
    let mut req = request("radio:tier", &[], list);
    req.limit = Some(2);
    assert_eq!(ids(&rank::rank(&conn, &req, NOW, 1).unwrap()), ["a-0", "r-1"]);
    req.limit = Some(3);
    req.context = "radio:tier2".into();
    assert!(ids(&rank::rank(&conn, &req, NOW, 1).unwrap()).contains(&"hw-song".to_string()), "a hidden work still beats silence");
}

#[test]
fn a_single_seed_with_five_hundred_candidates_keeps_a_hundred_edges() {
    let (_dir, conn) = common::open();
    track(&conn, "seed", "Seed", "z");
    let list: Vec<Value> = (0..500).map(|i| snapshot(&format!("x{i}"), &format!("Song {i}"), &format!("artist{}", i % 50))).collect();
    let res = rank::rank(&conn, &request("radio:seed", &["seed"], list), NOW, 1).unwrap();
    assert_eq!(res.items.len(), 10);
    let edges: i64 = conn.query_row("SELECT count(*) FROM candidate_edges WHERE seed_id = 'seed'", [], |r| r.get(0)).unwrap();
    assert_eq!(edges, pool::MAX_POOL_ITEMS as i64);
    assert!(conn.is_autocommit(), "the rank savepoint is released");
}

#[test]
fn tracks_without_an_artist_are_not_explored_as_a_new_artist() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    let mut list = candidates(&TEN, 2);
    list.extend((0..5).map(|i| snapshot(&format!("u{i}"), &format!("Untitled {i}"), "?")));
    for run in 0..20 {
        let res = rank::rank(&conn, &request(&format!("radio:u{run}"), &[], list.clone()), NOW, run).unwrap();
        assert!(res.items.iter().all(|i| i.reason.kind != "new"), "run {run}: no artist is not a new artist");
    }
}

#[test]
#[ignore = "release build only"]
fn large_candidate_set_ranks_quickly() {
    use std::time::Instant;
    let (_dir, conn) = common::open();
    know(&conn, &["x"]);
    let list: Vec<Value> = (0..500).map(|i| snapshot(&format!("x-{i}"), &format!("Song {i}"), "x")).collect();
    let start = Instant::now();
    let _ = rank::rank(&conn, &request("radio:speed", &[], list), NOW, 42).unwrap();
    let elapsed = start.elapsed().as_millis();
    let bound = if cfg!(debug_assertions) { 5000 } else { 200 };
    assert!(elapsed < bound, "500 candidates at limit 10: {elapsed}ms (bound {bound}ms)");
}

#[test]
fn same_seed_produces_same_batch() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    let list = candidates(&TEN, 4);
    let batch1 = ids(&rank::rank(&conn, &request("radio:det1", &[], list.clone()), NOW, 999).unwrap());
    let batch2 = ids(&rank::rank(&conn, &request("radio:det2", &[], list), NOW, 999).unwrap());
    assert_eq!(batch1, batch2, "deterministic ranking with same seed and different context");
}

#[test]
fn mmr_spreads_artists() {
    let (_dir, conn) = common::open();
    let artists = ["a", "b", "c", "d", "e"];
    know(&conn, &artists);
    let list: Vec<Value> = (0..50).flat_map(|n| artists.iter().map(move |a| snapshot(&format!("{a}-{n}"), &format!("{a} {n}"), a))).collect();
    let batch = ids(&rank::rank(&conn, &request("radio:spread", &[], list), NOW, 77).unwrap());
    let mut last_artist = "";
    let mut runs = 0;
    for id in &batch {
        let a = artist_of(id);
        if a == last_artist {
            runs += 1;
        } else {
            last_artist = a;
            runs = 0;
        }
        assert!(runs < 2, "artist {a} appears more than twice: {batch:?}");
    }
}

#[test]
fn stored_lists_of_seeds_and_finished_tracks_join_the_batch() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    track(&conn, "seed", "Seed", "z");
    let clouds = [snapshot("sc:1", "Cloud one", "p"), snapshot("sc:2", "Cloud two", "q"), snapshot("sc:3", "Cloud three", "r")];
    pool::replace(&conn, "seed", pool::SC_RELATED, &clouds, NOW - DAY).unwrap();
    suppress::not_interested(&conn, "sc:3", "exact", NOW).unwrap();
    play(&conn, "fin", "f", "live", NOW - 60_000, json!({}));
    pool::replace(&conn, "fin", pool::YT_RADIO, &[snapshot("u-1", "After fin", "u")], NOW - DAY).unwrap();
    play(&conn, "bad", "b", "live", NOW - 30_000, skip(1000));
    pool::replace(&conn, "bad", pool::YT_RADIO, &[snapshot("v-1", "After bad", "v")], NOW - DAY).unwrap();

    let mut req = request("radio:seed", &["seed"], candidates(&TEN, 1));
    req.session_id = Some("live".into());
    req.limit = Some(20);
    let res = rank::rank(&conn, &req, NOW, 4).unwrap();
    let got = ids(&res);
    for id in ["sc:1", "sc:2", "u-1"] {
        assert!(got.contains(&id.to_string()), "{id} joins: {got:?}");
    }
    assert!(!got.contains(&"sc:3".to_string()), "a dismissed track never joins");
    assert!(!got.contains(&"v-1".to_string()), "a track skipped this session lends no list");
    assert_eq!(res.dropped, 0, "only the request's own candidates count as dropped");
    let edges: i64 = conn.query_row("SELECT count(*) FROM candidate_edges WHERE seed_id = 'seed' AND source = 'rank'", [], |r| r.get(0)).unwrap();
    assert_eq!(edges, 10, "the seed keeps only the request's own candidates as ranked evidence");
}

#[test]
fn only_the_last_three_finished_tracks_lend_their_lists() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    track(&conn, "seed", "Seed", "z");
    for n in 0..4 {
        let id = format!("fin{n}");
        play(&conn, &id, &format!("f{n}"), "live", NOW - 60_000 + n * 1000, json!({}));
        pool::replace(&conn, &id, pool::YT_RADIO, &[snapshot(&format!("after-{n}"), &format!("After {n}"), &format!("u{n}"))], NOW - DAY).unwrap();
    }
    let mut req = request("radio:seed", &["seed"], candidates(&TEN, 1));
    req.session_id = Some("live".into());
    req.limit = Some(20);
    let got = ids(&rank::rank(&conn, &req, NOW, 4).unwrap());
    for id in ["after-1", "after-2", "after-3"] {
        assert!(got.contains(&id.to_string()), "{id} joins: {got:?}");
    }
    assert!(!got.contains(&"after-0".to_string()), "the fourth finished track back lends no list: {got:?}");
}

#[test]
fn the_artist_cap_holds_after_soundcloud_lists_join_the_batch() {
    let (_dir, conn) = common::open();
    know(&conn, &TEN);
    track(&conn, "seed", "Seed", "z");
    let first: Vec<Value> = (1..=8).map(|n| snapshot(&format!("sc:{n}"), &format!("Cloud a {n}"), "a")).collect();
    let second: Vec<Value> = (11..=18).map(|n| snapshot(&format!("sc:{n}"), &format!("Cloud b {n}"), "b")).collect();
    pool::replace(&conn, "seed", pool::SC_RELATED, &first, NOW - DAY).unwrap();
    play(&conn, "fin", "f", "live", NOW - 60_000, json!({}));
    pool::replace(&conn, "fin", pool::SC_RELATED, &second, NOW - DAY).unwrap();

    let mut req = request("radio:seed", &["seed"], candidates(&TEN, 4));
    req.session_id = Some("live".into());
    req.limit = Some(30);
    let res = rank::rank(&conn, &req, NOW, 5).unwrap();
    let artists: Vec<String> = res.items.iter().map(|i| i.track["artists"][0]["name"].as_str().unwrap().to_string()).collect();
    let clouds = ids(&res).iter().filter(|id| id.starts_with("sc:")).count();
    assert!(clouds >= 2, "the SoundCloud lists joined: {artists:?}");
    for window in artists.windows(10) {
        for artist in &artists {
            assert!(window.iter().filter(|a| *a == artist).count() <= 2, "artist {artist} exceeds 2 in a window: {artists:?}");
        }
    }
}
