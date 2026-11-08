mod common;

use nuvo_recs::canon::{self, Variant};
use nuvo_recs::keys;
use serde_json::Value;

#[test]
fn shared_fixture_matches() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("../../contracts/fixtures/canonical_titles.json")).unwrap();
    assert!(cases.len() >= 15);
    for case in cases {
        let title = case["title"].as_str().unwrap();
        let artist = case["artist"].as_str().unwrap();
        let got = canon::canon(title, artist);
        assert_eq!(got.work_key, case["workKey"].as_str().unwrap(), "work key of {title}");
        assert_eq!(got.artist_key, case["artistKey"].as_str().unwrap(), "artist key of {artist}");
        let variant = case["variant"].as_object().map(|v| (v["type"].as_str().unwrap().to_string(), v["by"].as_str().map(str::to_string)));
        assert_eq!(got.variant.map(|v| (v.kind.to_string(), v.by)), variant, "variant of {title}");
        let tags: Vec<&str> = case["tags"].as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
        assert_eq!(canon::version_tags(title), tags, "tags of {title}");
    }
}

#[test]
fn variant_credit_reads_by_clauses() {
    let c = canon::canon("Song (Remix by Someone Else)", "Artist");
    assert_eq!(c.variant, Some(Variant { kind: "remix", by: Some("someone else".into()) }));
}

#[test]
fn same_work_rules() {
    let ms = 200_000;
    assert_eq!(canon::same_work(("song name", "artist", ms), ("song name", "artist", 260_000)), 1.0, "a remix of any length is the same work");
    assert_eq!(canon::same_work(("song name", "artist", ms), ("song name", "other", ms)), 0.5, "same title by another artist is a cover");
    assert_eq!(canon::same_work(("dont stop me now", "queen", ms), ("don t stop me now", "queen", ms)), 1.0);
    assert_eq!(canon::same_work(("dont stop me now", "queen", ms), ("don t stop me now", "queen", 300_000)), 0.0, "fuzzy titles need lengths within 3 %");
    assert_eq!(canon::same_work(("dont stop me now", "queen", ms), ("don t stop me now", "other", ms)), 0.0, "fuzzy titles need the same artist");
    assert_eq!(canon::same_work(("love", "artist", ms), ("love2", "artist", ms)), 0.0, "short titles match exactly");
    assert_eq!(canon::same_work(("symphony part 1", "artist", ms), ("symphony part 2", "artist", ms)), 0.0, "numbers must match");
    assert_eq!(canon::same_work(("blue", "artist", ms), ("blue", "artist", ms)), 1.0);
    assert_eq!(canon::same_work(("symphony part 1 2", "artist", ms), ("symphony part 12", "artist", ms)), 0.0, "digit runs compare as lists");
}

#[test]
fn bracketed_numbers_tell_works_apart() {
    let work = |title: &str| canon::canon(title, "Artist").work_key;
    assert_eq!(work("Time (Part 1)"), "time 1");
    assert_eq!(work("Time (Part 2)"), "time 2");
    assert_eq!(canon::same_work((&work("Time (Part 1)"), "artist", 200_000), (&work("Time (Part 2)"), "artist", 200_000)), 0.0);
    assert_eq!(work("Time (2019 Remaster)"), "time", "a year is not part of the work");
    assert_eq!(work("Time (Official Video 4K)"), "time");
    assert_eq!(work("Time (feat. 2 Chainz)"), "time", "credits are not part of the work");
    let tagged = canon::canon("Time (Part 2) (Remix 2)", "Artist");
    assert_eq!((tagged.work_key.as_str(), tagged.variant.map(|v| v.kind)), ("time 2", Some("remix")), "a tagged segment keeps no numbers");
}

#[test]
fn keys_are_filled_lazily_and_follow_snapshot_changes() {
    let (_dir, conn) = common::open();
    common::track(&conn, "a", "Song (Skrillex Remix)", "Artist - Topic");
    common::track(&conn, "b", "Other", "Artist");
    assert_eq!(keys::refresh(&conn).unwrap(), 2);
    assert_eq!(keys::refresh(&conn).unwrap(), 0, "nothing stale");
    let map = keys::load(&conn, &["a".into(), "b".into(), "missing".into()]).unwrap();
    assert_eq!(map.len(), 2);
    assert_eq!((map["a"].work.as_str(), map["a"].artist.as_str()), ("song", "artist"));
    assert_eq!(map["a"].variant_key(), "song|remix|skrillex");
    assert_eq!(map["b"].variant_key(), "other||");

    nuvo_store::tracks::upsert(&conn, &common::snapshot("b", "Renamed (Live)", "Artist"), common::NOW).unwrap();
    assert_eq!(keys::refresh(&conn).unwrap(), 1);
    let map = keys::load(&conn, &["b".into()]).unwrap();
    assert_eq!((map["b"].work.as_str(), map["b"].variant_type.as_deref()), ("renamed", Some("live")));
}
