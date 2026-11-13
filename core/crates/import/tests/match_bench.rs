use std::collections::HashMap;

use nuvo_import::SourceRow;
use nuvo_import::cascade::{Cascade, is_finished, next_searches, outcome, record};
use serde::Deserialize;
use serde_json::Value;

// Real YouTube Music and SoundCloud answers recorded on 2026-11-13 for 81 import rows in English and Russian.
// `accept` lists every answer that is the same recording, labelled by hand.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    title: String,
    artists: Vec<String>,
    album: Option<String>,
    duration_ms: Option<i64>,
    accept: Vec<String>,
}

#[derive(Deserialize)]
struct Recorded {
    ms: u64,
    items: Vec<Value>,
}

#[derive(Deserialize)]
struct Bench {
    rows: Vec<Row>,
    searches: HashMap<String, Recorded>,
}

#[derive(Default)]
struct Tally {
    findable: usize,
    right: usize,
    wrong: usize,
    searches: usize,
    youtube: usize,
    ms: u64,
    soundcloud_rows: usize,
    soundcloud_ms: u64,
}

// A round's answers arrive in their recorded order; a sure answer ends the row before the rest arrive
fn run(bench: &Bench) -> Tally {
    let mut tally = Tally::default();
    for row in &bench.rows {
        let source = SourceRow { title: row.title.clone(), artists: row.artists.clone(), album: row.album.clone(), duration_ms: row.duration_ms, ..Default::default() };
        let mut cascade = Cascade::default();
        let mut ms = 0;
        loop {
            let mut round: Vec<(usize, &'static str, &Recorded)> =
                next_searches(&source, &cascade).into_iter().map(|(step, s)| (step, s.source, &bench.searches[&format!("{}:{}:{}", s.source, s.filter, s.query)])).collect();
            if round.is_empty() {
                break;
            }
            tally.searches += round.len();
            tally.youtube += round.iter().filter(|(_, source, _)| *source == "youtube").count();
            round.sort_by_key(|(_, _, found)| found.ms);
            let mut spent = round[round.len() - 1].2.ms;
            for (step, _, found) in round {
                assert!(record(&source, &mut cascade, step, found.items.clone(), false));
                if is_finished(&source, &cascade) {
                    spent = found.ms;
                    break;
                }
            }
            ms += spent;
        }
        tally.ms += ms;
        if row.accept.iter().all(|id| id.starts_with("sc:")) && !row.accept.is_empty() {
            tally.soundcloud_rows += 1;
            tally.soundcloud_ms += ms;
        }
        let result = outcome(&source, &cascade);
        tally.findable += usize::from(!row.accept.is_empty());
        if let (Some(track), "likely" | "check") = (&result.track, result.label) {
            let id = track["id"].as_str().unwrap_or_default();
            if row.accept.iter().any(|a| a == id) {
                tally.right += 1;
            } else {
                tally.wrong += 1;
                println!("wrong: {} - {} -> {id} {}", row.artists.join(", "), row.title, track["title"]);
            }
        } else if !row.accept.is_empty() {
            println!("missed: {} - {} ({})", row.artists.join(", "), row.title, result.reason);
        }
    }
    tally
}

#[test]
fn import_matching_on_recorded_searches() {
    let bench: Bench = serde_json::from_str(include_str!("fixtures/match-bench.json")).unwrap();
    let t = run(&bench);
    println!(
        "rows {} findable {} right {} ({:.1}%) wrong {} ({:.1}%) searches {} ({} YouTube) search time {} s, SoundCloud-only rows {} at {} ms each",
        bench.rows.len(),
        t.findable,
        t.right,
        100.0 * t.right as f64 / t.findable as f64,
        t.wrong,
        100.0 * t.wrong as f64 / bench.rows.len() as f64,
        t.searches,
        t.youtube,
        t.ms / 1000,
        t.soundcloud_rows,
        t.soundcloud_ms / t.soundcloud_rows as u64
    );
    // Before YouTube and SoundCloud were asked together: 75 right, 1 wrong, 131 YouTube searches, 65 s
    assert!(t.right >= 76, "matched {} of {}", t.right, t.findable);
    assert_eq!(t.wrong, 0);
    assert!(t.youtube <= 131);
}
