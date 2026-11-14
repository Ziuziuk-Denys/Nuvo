mod common;

use nuvo_store::lyrics_words::{self, ALIGNED, SYNCED, TRANSCRIBED, Timing};
use nuvo_store::{MIGRATIONS, open_connection};

fn timing(model: &str, confidence: Option<f64>) -> Timing {
    Timing { source_hash: "a".into(), model: model.into(), confidence, content: format!("<tt>{model}</tt>") }
}

#[test]
fn one_timing_is_kept_per_track_and_source_and_a_newer_one_replaces_it() {
    let (_dir, conn) = common::open();
    assert_eq!(lyrics_words::get(&conn, "t", SYNCED).unwrap(), None);
    let first = timing("whisper-base", Some(0.6));
    lyrics_words::put(&conn, "t", SYNCED, &first, 1).unwrap();
    assert_eq!(lyrics_words::get(&conn, "t", SYNCED).unwrap(), Some(first));
    let better = timing("whisper-small", Some(0.7));
    lyrics_words::put(&conn, "t", SYNCED, &better, 2).unwrap();
    assert_eq!(lyrics_words::get(&conn, "t", SYNCED).unwrap(), Some(better.clone()));
    assert_eq!(lyrics_words::get(&conn, "other", SYNCED).unwrap(), None);
    assert_eq!(lyrics_words::get(&conn, "t", TRANSCRIBED).unwrap(), None);
    assert!(lyrics_words::put(&conn, "t", "guessed", &better, 3).is_err(), "only the three sources");
}

#[test]
fn forgetting_made_lyrics_keeps_the_timing_of_synced_lines() {
    let (_dir, conn) = common::open();
    for source in [SYNCED, ALIGNED, TRANSCRIBED] {
        lyrics_words::put(&conn, "t", source, &timing("whisper-base", Some(0.5)), 1).unwrap();
    }
    lyrics_words::forget_made(&conn, "t").unwrap();
    assert!(lyrics_words::get(&conn, "t", SYNCED).unwrap().is_some());
    assert_eq!(lyrics_words::get(&conn, "t", ALIGNED).unwrap(), None);
    assert_eq!(lyrics_words::get(&conn, "t", TRANSCRIBED).unwrap(), None);
}

#[test]
fn word_timing_stored_before_sources_becomes_synced() {
    let (dir, conn) = common::open();
    conn.execute_batch(
        "DROP TABLE lyrics_words;
         CREATE TABLE lyrics_words (track_id TEXT PRIMARY KEY, source_hash TEXT NOT NULL, model TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
         INSERT INTO lyrics_words VALUES ('t', 'h', 'whisper-base', '<tt/>', 5);",
    )
    .unwrap();
    conn.pragma_update(None, "user_version", MIGRATIONS.len() as i64 - 1).unwrap();
    drop(conn);
    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    let kept = Timing { source_hash: "h".into(), model: "whisper-base".into(), confidence: None, content: "<tt/>".into() };
    assert_eq!(lyrics_words::get(&conn, "t", SYNCED).unwrap(), Some(kept));
}
