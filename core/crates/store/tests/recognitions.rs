mod common;

use nuvo_store::{StoreError, recognitions};
use serde_json::json;

#[test]
fn lists_newest_first_and_deletes() {
    let (_dir, conn) = common::open();
    recognitions::insert(&conn, "a", 10, "link", "https://youtu.be/x", &json!({"title": "A"})).unwrap();
    recognitions::insert(&conn, "b", 20, "file", "clip.mp4", &json!({"title": "B"})).unwrap();
    recognitions::insert(&conn, "c", 20, "system", "System audio", &json!({"title": "C"})).unwrap();

    let items = recognitions::list(&conn, 50).unwrap();
    let ids: Vec<&str> = items.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["c", "b", "a"], "same timestamp: the later insert first");
    assert_eq!(items[2].result, json!({"title": "A"}));
    assert_eq!(items[2].created_at, 10);
    assert_eq!(recognitions::list(&conn, 1).unwrap().len(), 1);

    recognitions::delete(&conn, "b").unwrap();
    assert!(matches!(recognitions::delete(&conn, "b"), Err(StoreError::NotFound("recognition"))));
    assert_eq!(recognitions::list(&conn, 50).unwrap().len(), 2);
}

#[test]
fn keeps_only_the_newest_500() {
    let (_dir, conn) = common::open();
    for n in 0..505 {
        recognitions::insert(&conn, &format!("r{n}"), n, "link", "x", &json!({})).unwrap();
    }
    let items = recognitions::list(&conn, 1000).unwrap();
    assert_eq!(items.len(), 500);
    assert_eq!(items[0].id, "r504");
    assert_eq!(items[499].id, "r5");
}

#[test]
fn unknown_input_kinds_are_refused() {
    let (_dir, conn) = common::open();
    assert!(recognitions::insert(&conn, "x", 1, "camera", "x", &json!({})).is_err());
}

#[test]
fn a_version_1_library_is_backed_up_and_upgraded() {
    let (dir, conn) = common::open();
    nuvo_store::settings::set(&conn, "k", &json!("kept")).unwrap();
    conn.execute_batch(common::UNDO_OWNER_MIGRATIONS).unwrap();
    conn.execute_batch(common::UNDO_RECS_MIGRATION).unwrap();
    conn.execute_batch(
        "DROP TABLE recognitions;
         ALTER TABLE playlists DROP COLUMN sort_mode;
         ALTER TABLE playlists DROP COLUMN sort_desc;
         DROP TABLE playlist_covers;
         DROP TABLE track_trims;
         DROP TABLE scrobble_queue;
         DROP INDEX play_events_idempotent;
         PRAGMA user_version = 1;",
    )
    .unwrap();
    drop(conn);

    let path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    let conn = nuvo_store::open_connection(&path, &common::KEY, &backups).unwrap();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 21);
    assert_eq!(nuvo_store::settings::get(&conn, "k").unwrap(), Some(json!("kept")));
    recognitions::insert(&conn, "a", 1, "file", "x", &json!({})).unwrap();
    let names: Vec<String> = std::fs::read_dir(&backups).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    assert!(names.len() == 1 && names[0].ends_with("-v1.db"), "{names:?}");
}

#[test]
fn long_input_labels_are_truncated_to_512() {
    let (_dir, conn) = common::open();
    let long_label = "x".repeat(600);
    recognitions::insert(&conn, "a", 1, "link", &long_label, &json!({})).unwrap();
    let items = recognitions::list(&conn, 10).unwrap();
    assert_eq!(items.len(), 1);
    let stored_label: String = conn.query_row(
        "SELECT input_label FROM recognitions WHERE id = 'a'",
        [],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(stored_label.len(), 512);
}

#[test]
fn negative_and_large_limits_are_clamped_to_1_and_500() {
    let (_dir, conn) = common::open();
    for n in 0..3 {
        recognitions::insert(&conn, &format!("r{n}"), n, "link", "x", &json!({})).unwrap();
    }
    assert_eq!(recognitions::list(&conn, -5).unwrap().len(), 1, "negative limit clamped to 1");
    assert_eq!(recognitions::list(&conn, 0).unwrap().len(), 1, "zero limit clamped to 1");
    assert_eq!(recognitions::list(&conn, 1000).unwrap().len(), 3, "large limit clamped to 500");
}

#[test]
fn a_long_multibyte_label_is_cut_on_a_char_boundary() {
    let (_dir, conn) = common::open();
    let label = format!("a{}", "я".repeat(300));
    recognitions::insert(&conn, "a", 1, "link", &label, &json!({})).unwrap();
    let stored: String = conn.query_row("SELECT input_label FROM recognitions WHERE id = 'a'", [], |r| r.get(0)).unwrap();
    assert!(stored.len() <= 512 && label.starts_with(&stored) && stored.len() > 500);
}
