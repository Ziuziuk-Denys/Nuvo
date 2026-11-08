mod common;

use nuvo_store::{StoreError, library, library::SavedKind, tracks};
use serde_json::json;

#[test]
fn like_stores_the_snapshot_and_lists_it_with_viewer() {
    let (_dir, conn) = common::open();
    library::like(&conn, "t1", Some(common::track("t1", "A")), 1000).unwrap();
    let page = library::liked_page(&conn, 100, None).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].track["title"], "Title t1");
    assert_eq!(page.items[0].track["viewer"]["liked"], true);
    assert_eq!(page.items[0].liked_at, "1970-01-01T00:00:01.000Z");
    assert!(page.next_cursor.is_none());
    assert!(library::is_liked(&conn, "t1").unwrap());
}

#[test]
fn liking_twice_keeps_the_first_timestamp_and_unlike_is_idempotent() {
    let (_dir, conn) = common::open();
    library::like(&conn, "t1", Some(common::track("t1", "A")), 1000).unwrap();
    library::like(&conn, "t1", None, 5000).unwrap();
    assert_eq!(library::liked_page(&conn, 10, None).unwrap().items[0].liked_at, "1970-01-01T00:00:01.000Z");
    library::unlike(&conn, "t1").unwrap();
    library::unlike(&conn, "t1").unwrap();
    assert!(library::liked_page(&conn, 10, None).unwrap().items.is_empty());
}

#[test]
fn like_without_snapshot_needs_a_known_track() {
    let (_dir, conn) = common::open();
    assert!(matches!(library::like(&conn, "nope", None, 1).unwrap_err(), StoreError::NotFound("track")));
}

#[test]
fn snapshot_id_must_match_the_path_id() {
    let (_dir, conn) = common::open();
    let err = library::like(&conn, "t1", Some(common::track("t2", "A")), 1).unwrap_err();
    assert!(matches!(err, StoreError::Invalid(_)));
}

#[test]
fn oversized_snapshots_are_rejected() {
    let (_dir, conn) = common::open();
    let mut big = common::track("t1", "A");
    big["padding"] = json!("x".repeat(70 * 1024));
    assert!(matches!(tracks::upsert(&conn, &big, 1).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn liked_pages_walk_every_track_once_newest_first() {
    let (_dir, conn) = common::open();
    for i in 0..5 {
        let id = format!("sc:{i}");
        // Two tracks share a timestamp to exercise the id tie-breaker in the cursor.
        library::like(&conn, &id, Some(common::track(&id, "A")), 1000 + (i / 2) as i64).unwrap();
    }
    let mut seen = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page = library::liked_page(&conn, 2, cursor.as_deref()).unwrap();
        seen.extend(page.items.iter().map(|i| i.track["id"].as_str().unwrap().to_string()));
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    assert_eq!(seen, vec!["sc:4", "sc:3", "sc:2", "sc:1", "sc:0"]);
}

#[test]
fn malformed_cursor_is_invalid_input() {
    let (_dir, conn) = common::open();
    assert!(matches!(library::liked_page(&conn, 10, Some("garbage")).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn saved_items_use_the_singular_key_the_renderer_reads() {
    let (_dir, conn) = common::open();
    library::save_item(&conn, SavedKind::Album, "MPRE1", Some(json!({"title": "Album", "trackCount": 9})), 2000).unwrap();
    library::save_item(&conn, SavedKind::Artist, "UC1", None, 3000).unwrap();
    let albums = library::list_saved(&conn, SavedKind::Album).unwrap();
    assert_eq!(albums, vec![json!({"album": {"id": "MPRE1", "title": "Album", "trackCount": 9}, "savedAt": "1970-01-01T00:00:02.000Z"})]);
    let artists = library::list_saved(&conn, SavedKind::Artist).unwrap();
    assert_eq!(artists[0]["artist"]["id"], "UC1");
    library::remove_item(&conn, SavedKind::Album, "MPRE1").unwrap();
    assert!(library::list_saved(&conn, SavedKind::Album).unwrap().is_empty());
    assert_eq!(SavedKind::from_plural("playlists"), Some(SavedKind::Playlist));
    assert_eq!(SavedKind::from_plural("tracks"), None);
}

#[test]
fn liked_ids_lists_ids_newest_first() {
    let (_dir, conn) = common::open();
    library::like(&conn, "a", Some(common::track("a", "X")), 1).unwrap();
    library::like(&conn, "b", Some(common::track("b", "X")), 2).unwrap();
    assert_eq!(library::liked_ids(&conn).unwrap(), vec!["b".to_string(), "a".to_string()]);
}
