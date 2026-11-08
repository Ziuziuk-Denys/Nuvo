mod common;

use std::time::Instant;

use common::{NOW, snapshot};
use nuvo_contracts::RankRequest;
use nuvo_recs::{keys, rank};

/// Timings on a file-backed database: run with `--release -- --ignored --nocapture`.
#[test]
#[ignore = "timing probe, release build"]
fn timings_on_disk() {
    let (_dir, conn) = common::open_on_disk();
    conn.execute_batch("BEGIN").unwrap();
    for i in 0..10_000 {
        nuvo_store::tracks::upsert(&conn, &snapshot(&format!("lib-{i}"), &format!("Library song {i} (Live)"), &format!("artist{}", i % 700)), NOW).unwrap();
    }
    conn.execute_batch("COMMIT").unwrap();
    let start = Instant::now();
    assert_eq!(keys::refresh(&conn).unwrap(), 10_000);
    println!("first keys::refresh over 10k tracks: {} ms", start.elapsed().as_millis());

    let candidates = (0..500).map(|i| snapshot(&format!("c-{i}"), &format!("Candidate {i}"), &format!("cand{}", i % 50))).collect();
    let req = RankRequest { context: "radio:perf".into(), candidates, ..Default::default() };
    let start = Instant::now();
    assert_eq!(rank::rank(&conn, &req, NOW, 1).unwrap().items.len(), 10);
    println!("500-candidate rank: {} ms", start.elapsed().as_millis());
}
