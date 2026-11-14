mod common;

use nuvo_contracts::{LyricsCandidate, LyricsQuality, RawLyrics};
use nuvo_store::lyrics_cache;

#[test]
fn stores_found_and_not_found_results() {
    let (_dir, conn) = common::open();
    assert!(lyrics_cache::get(&conn, "t").unwrap().is_none());
    let candidate = LyricsCandidate {
        provider: "lrclib".into(), content_kind: "line_synced".into(), sync_level: "line_level".into(),
        quality: LyricsQuality { total: 0.8, match_score: 1.0, content: 1.0, sync: 0.6, source: 0.7, reasons: vec![] },
        lyrics: RawLyrics { format: "lrc".into(), content: "[00:01.00] hi".into() }, matched_track: None,
        top_priority: false,
        made: None,
    };
    lyrics_cache::put(&conn, "t", Some(&candidate), false, 10).unwrap();
    let cached = lyrics_cache::get(&conn, "t").unwrap().unwrap();
    assert_eq!(cached.candidate, Some(candidate));
    assert_eq!(cached.fetched_at, 10);

    lyrics_cache::put(&conn, "u", None, true, 20).unwrap();
    let none = lyrics_cache::get(&conn, "u").unwrap().unwrap();
    assert!(none.candidate.is_none() && none.instrumental);
}
