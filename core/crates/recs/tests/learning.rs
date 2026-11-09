mod common;

use common::{NOW, snapshot};
use nuvo_contracts::RankRequest;
use nuvo_recs::model::{self, FIXED, LEARN_AFTER, Model};
use nuvo_recs::{feedback, rank};
use serde_json::json;

fn event(id: &str, extra: serde_json::Value) -> nuvo_contracts::RecordPlaybackEvent {
    let mut body = json!({"listeningSessionId": "s", "trackId": id, "playedDurationMs": 200000, "trackDurationMs": 200000, "completed": true, "startedAt": NOW});
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    serde_json::from_value(body).unwrap()
}

fn seen(conn: &nuvo_store::Connection) -> i64 {
    conn.query_row("SELECT coalesce(max(events_seen), 0) FROM rec_model", [], |r| r.get(0)).unwrap()
}

#[test]
fn outcomes_of_served_tracks_train_the_model() {
    let (_dir, conn) = common::open();
    let req = RankRequest { context: "radio:x".into(), candidates: vec![snapshot("a", "A", "x"), snapshot("b", "B", "y")], ..Default::default() };
    rank::rank(&conn, &req, NOW, 1).unwrap();
    common::track(&conn, "never-served", "N", "z");

    feedback::after_play(&conn, &event("never-served", json!({})), NOW).unwrap();
    feedback::after_play(&conn, &event("a", json!({"completed": false, "endReason": "stop", "playedDurationMs": 1000})), NOW).unwrap();
    assert_eq!(seen(&conn), 0, "unserved tracks and plays without a verdict teach nothing");

    feedback::after_play(&conn, &event("a", json!({})), NOW).unwrap();
    assert_eq!(seen(&conn), 1);
    let json: String = conn.query_row("SELECT weights_json FROM rec_model", [], |r| r.get(0)).unwrap();
    let weights: Vec<f64> = serde_json::from_str(&json).unwrap();
    assert!(weights[6] > FIXED[6], "a finished first pick raises the source-rank weight");

    feedback::after_play(&conn, &event("b", json!({"completed": false, "endReason": "skip", "playedDurationMs": 1000})), NOW).unwrap();
    assert_eq!(seen(&conn), 2);
    assert!(feedback::after_play(&conn, &event("a", json!({})), NOW + 2 * 86_400_000).is_ok());
    assert_eq!(seen(&conn), 2, "a batch older than a day no longer teaches");
}

#[test]
fn learned_weights_take_over_after_500_outcomes() {
    let (_dir, conn) = common::open();
    assert!(!Model::load(&conn).unwrap().learned);
    let mut reversed = [0.0; 8];
    reversed[6] = -1.0;
    conn.execute(
        "INSERT INTO rec_model (key, weights_json, events_seen, updated_at) VALUES ('global', ?1, ?2, 0)",
        rusqlite::params![serde_json::to_string(&reversed).unwrap(), LEARN_AFTER - 1],
    )
    .unwrap();
    assert!(!Model::load(&conn).unwrap().learned, "499 outcomes: still the fixed weights");
    model::learn(&conn, &[0.0; 7], false, NOW).unwrap();
    let learned = Model::load(&conn).unwrap();
    assert!(learned.learned);
    assert!(learned.weights[6] < 0.0);

    let candidates = (0..5).map(|i| snapshot(&format!("t{i}"), &format!("Track {i}"), &format!("artist{i}"))).collect();
    let req = RankRequest { context: "radio:x".into(), candidates, limit: Some(5), ..Default::default() };
    let order: Vec<String> = rank::rank(&conn, &req, NOW, 1).unwrap().items.iter().map(|i| i.track["id"].as_str().unwrap().to_string()).collect();
    assert_eq!(order[0], "t4", "the learned model now drives the order: {order:?}");
}

#[test]
fn corrupt_weights_fall_back_to_fixed() {
    let (_dir, conn) = common::open();
    conn.execute(
        "INSERT INTO rec_model (key, weights_json, events_seen, updated_at) VALUES ('global', ?1, 600, 0)",
        rusqlite::params!["[1.0, NaN, 0.3, 1.2, 0.8, 0.2, 0.6, 0.0]"],
    )
    .unwrap();
    model::learn(&conn, &[0.0; 7], true, NOW).unwrap();
    let json: String = conn.query_row("SELECT weights_json FROM rec_model", [], |r| r.get(0)).unwrap();
    let weights: Vec<f64> = serde_json::from_str(&json).unwrap();
    assert!(weights.iter().all(|w| w.is_finite()), "all weights are finite after recover from corruption");
    assert_eq!(weights[6], FIXED[6], "source-rank weight is restored from FIXED");
}

#[test]
fn once_only_learning_per_served_row() {
    let (_dir, conn) = common::open();
    let req = RankRequest { context: "radio:x".into(), candidates: vec![snapshot("a", "A", "x")], ..Default::default() };
    rank::rank(&conn, &req, NOW, 1).unwrap();
    common::track(&conn, "a", "A", "x");

    feedback::after_play(&conn, &event("a", json!({})), NOW).unwrap();
    assert_eq!(seen(&conn), 1);
    let w1: Vec<f64> = conn.query_row("SELECT weights_json FROM rec_model", [], |r| {
        let s: String = r.get(0)?;
        Ok(serde_json::from_str(&s).unwrap())
    }).unwrap();

    feedback::after_play(&conn, &event("a", json!({})), NOW).unwrap();
    assert_eq!(seen(&conn), 1, "same event teaches only once");
    let w2: Vec<f64> = conn.query_row("SELECT weights_json FROM rec_model", [], |r| {
        let s: String = r.get(0)?;
        Ok(serde_json::from_str(&s).unwrap())
    }).unwrap();
    assert_eq!(w1, w2, "weights unchanged on second play of same event");
}

#[test]
fn single_seed_with_savepoint() {
    let (_dir, conn) = common::open();
    common::track(&conn, "seed", "Seed", "z");
    let candidates = vec![snapshot("t0", "Track 0", "a"), snapshot("t1", "Track 1", "b")];
    let req = RankRequest { context: "radio:seed".into(), seeds: vec!["seed".into()], candidates, ..Default::default() };
    let res = rank::rank(&conn, &req, NOW, 1).unwrap();
    assert_eq!(res.items.len(), 2);
    let edges: i64 = conn.query_row("SELECT count(*) FROM candidate_edges WHERE seed_id = 'seed'", [], |r| r.get(0)).unwrap();
    assert_eq!(edges, 2, "single-seed request keeps candidates as similarity evidence");
}
