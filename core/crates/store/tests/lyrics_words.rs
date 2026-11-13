mod common;

use nuvo_store::lyrics_words::{self, Timing};

#[test]
fn one_timing_is_kept_per_track_and_a_newer_one_replaces_it() {
    let (_dir, conn) = common::open();
    assert_eq!(lyrics_words::get(&conn, "t").unwrap(), None);
    let first = Timing { source_hash: "a".into(), model: "whisper-base".into(), content: "<tt/>".into() };
    lyrics_words::put(&conn, "t", &first, 1).unwrap();
    assert_eq!(lyrics_words::get(&conn, "t").unwrap(), Some(first));
    let better = Timing { source_hash: "a".into(), model: "whisper-small".into(), content: "<tt></tt>".into() };
    lyrics_words::put(&conn, "t", &better, 2).unwrap();
    assert_eq!(lyrics_words::get(&conn, "t").unwrap(), Some(better));
    assert_eq!(lyrics_words::get(&conn, "other").unwrap(), None);
}
