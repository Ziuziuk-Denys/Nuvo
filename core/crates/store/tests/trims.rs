mod common;

use nuvo_contracts::{SetTrim, TrackTrim};
use nuvo_store::{StoreError, trims};

fn span(start_ms: i64, end_ms: i64) -> SetTrim {
    SetTrim { start_ms, end_ms, track: None }
}

#[test]
fn trims_are_validated_against_the_track_duration() {
    let (_dir, conn) = common::open();
    let first = SetTrim { start_ms: 0, end_ms: 5000, track: Some(common::track("a", "X")) };
    assert_eq!(trims::set(&conn, "a", &first, 1).unwrap(), TrackTrim { track_id: "a".into(), start_ms: 0, end_ms: 5000 });
    assert!(trims::set(&conn, "a", &span(195_000, 200_000), 2).is_ok(), "the span may end exactly at the duration");

    for (start, end) in [(-1, 10_000), (10_000, 10_000), (20_000, 10_000), (0, 4999), (195_000, 200_001)] {
        let err = trims::set(&conn, "a", &span(start, end), 3).unwrap_err();
        assert!(matches!(err, StoreError::Invalid(_)), "{start}..{end}");
    }
    assert_eq!(trims::get(&conn, "a").unwrap().unwrap().start_ms, 195_000, "a rejected trim leaves the old one");
    assert!(matches!(trims::set(&conn, "unknown", &span(0, 10_000), 4).unwrap_err(), StoreError::NotFound("track")));
}

#[test]
fn list_replace_and_delete() {
    let (_dir, conn) = common::open();
    for (id, at) in [("a", 1), ("b", 2)] {
        let input = SetTrim { start_ms: 1000, end_ms: 61_000, track: Some(common::track(id, "X")) };
        trims::set(&conn, id, &input, at).unwrap();
    }
    trims::set(&conn, "a", &span(2000, 62_000), 3).unwrap();
    let all = trims::list(&conn).unwrap();
    assert_eq!(all.iter().map(|t| t.track_id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    assert_eq!(all[0].start_ms, 2000);

    trims::delete(&conn, "a").unwrap();
    trims::delete(&conn, "a").unwrap();
    assert_eq!(trims::get(&conn, "a").unwrap(), None);
    assert_eq!(trims::list(&conn).unwrap().len(), 1);
}
