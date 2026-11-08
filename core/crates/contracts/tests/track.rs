use nuvo_contracts::{TrackFields, source_of, with_viewer};
use serde_json::json;

#[test]
fn extracts_indexed_fields_from_a_renderer_snapshot() {
    let snapshot = json!({
        "id": "dQw4w9WgXcQ",
        "title": "Song",
        "artists": [{"id": "a1", "name": "First"}, {"id": "a2", "name": "Second"}],
        "album": {"id": "al1", "title": "Album"},
        "durationMs": 212345.6,
        "cover": {"url": "https://i.ytimg.com/x.jpg", "width": 512, "height": 512},
        "explicit": true
    });
    let f = TrackFields::from_snapshot(&snapshot).unwrap();
    assert_eq!(f.id, "dQw4w9WgXcQ");
    assert_eq!(f.artist, "First");
    assert_eq!(f.album.as_deref(), Some("Album"));
    assert_eq!(f.album_id.as_deref(), Some("al1"));
    assert_eq!(f.duration_ms, 212346, "fractional durations are rounded, not rejected");
    assert_eq!(f.cover_url.as_deref(), Some("https://i.ytimg.com/x.jpg"));
    assert_eq!(f.source, "youtube");
}

#[test]
fn minimal_snapshot_is_accepted() {
    let f = TrackFields::from_snapshot(&json!({"id": "sc:123"})).unwrap();
    assert_eq!(f.title, "");
    assert_eq!(f.duration_ms, 0);
    assert_eq!(f.source, "soundcloud");
    assert_eq!(source_of("abc"), "youtube");
}

#[test]
fn invalid_snapshots_are_rejected() {
    assert!(TrackFields::from_snapshot(&json!("x")).is_err());
    assert!(TrackFields::from_snapshot(&json!({"title": "no id"})).is_err());
    assert!(TrackFields::from_snapshot(&json!({"id": ""})).is_err());
    assert!(TrackFields::from_snapshot(&json!({"id": "x".repeat(300)})).is_err());
}

#[test]
fn viewer_is_added_without_touching_other_fields() {
    let out = with_viewer(json!({"id": "x", "extra": 1}), true);
    assert_eq!(out, json!({"id": "x", "extra": 1, "viewer": {"liked": true}}));
}

#[test]
fn the_indexed_artist_is_the_first_of_the_list_and_the_whole_list_is_kept() {
    let snapshot = json!({"id": "t", "artists": [{"id": "a", "name": "Nova"}, {"id": "b", "name": "Guest"}]});
    let f = TrackFields::from_snapshot(&snapshot).unwrap();
    assert_eq!(f.artist, "Nova");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&f.artists_json).unwrap(), snapshot["artists"]);
}
