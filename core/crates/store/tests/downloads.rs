mod common;

use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_store::downloads::{self, NewDownload};
use nuvo_store::{open_connection, tracks};

fn job(ids: &[&str]) -> NewDownload {
    NewDownload { dir: "/home/u/Music".into(), format: "original".into(), label: "Mix".into(), playlist_file: true, track_ids: ids.iter().map(|s| s.to_string()).collect() }
}

fn cache(conn: &nuvo_store::Connection, id: &str) {
    cache_index::upsert(conn, &CacheEntry { track_id: id.into(), path: format!("/c/{id}.lac"), size_bytes: 10, mime: "audio/webm".into(), codec: Some("opus".into()) }, 1).unwrap();
}

#[test]
fn items_wait_for_the_cache_then_finish_in_order() {
    let (_dir, conn) = common::open();
    for id in ["a", "b"] {
        tracks::upsert(&conn, &common::track(id, "X"), 1).unwrap();
    }
    let summary = downloads::create(&conn, &job(&["a", "b"]), 2).unwrap();
    assert_eq!((summary.total, summary.waiting, summary.status.as_str()), (2, 2, "running"));
    assert!(downloads::next(&conn).unwrap().is_none());
    assert_eq!(downloads::waiting(&conn, 10).unwrap().len(), 2);

    cache(&conn, "b");
    let ready = downloads::next(&conn).unwrap().unwrap();
    assert_eq!((ready.track_id.as_str(), ready.position, ready.mime.as_deref(), ready.local), ("b", 1, Some("audio/webm"), false));
    assert!(!downloads::finish(&conn, &ready.download_id, ready.position, Ok("X - b.webm".into())).unwrap());
    assert_eq!(downloads::fail_track(&conn, "a", "unavailable").unwrap(), 1);
    let listed = &downloads::list(&conn).unwrap()[0];
    assert_eq!((listed.done, listed.failed, listed.waiting, listed.status.as_str()), (1, 1, 0, "done"));
    let (label, dir, playlist_file, files) = downloads::saved_files(&conn, &summary.id).unwrap();
    assert_eq!((label.as_str(), dir.as_str(), playlist_file, files), ("Mix", "/home/u/Music", true, vec!["X - b.webm".to_string()]));
}

#[test]
fn cancel_and_limits() {
    let (_dir, conn) = common::open();
    tracks::upsert(&conn, &common::track("a", "X"), 1).unwrap();
    let summary = downloads::create(&conn, &job(&["a"]), 2).unwrap();
    downloads::cancel(&conn, &summary.id).unwrap();
    cache(&conn, "a");
    assert!(downloads::next(&conn).unwrap().is_none());
    assert_eq!(downloads::list(&conn).unwrap()[0].status, "cancelled");
    assert!(downloads::create(&conn, &job(&["missing"]), 3).is_err(), "unknown track");
    assert_eq!(downloads::list(&conn).unwrap().len(), 1, "a refused job leaves no row behind");
    assert!(downloads::create(&conn, &job(&[]), 3).is_err(), "nothing to save");
    let many: Vec<String> = (0..5001).map(|i| i.to_string()).collect();
    let refs: Vec<&str> = many.iter().map(String::as_str).collect();
    assert!(downloads::create(&conn, &job(&refs), 3).is_err());
    let mut bad = job(&["a"]);
    bad.format = "flac".into();
    assert!(downloads::create(&conn, &bad, 3).is_err(), "the table only knows original and mp3");
}

#[test]
fn ids_come_from_a_playlist_or_likes() {
    let (_dir, conn) = common::open();
    for id in ["a", "b"] {
        tracks::upsert(&conn, &common::track(id, "X"), 1).unwrap();
    }
    conn.execute("INSERT INTO liked_tracks (track_id, liked_at) VALUES ('a', 1), ('b', 2)", []).unwrap();
    assert_eq!(downloads::track_ids_for(&conn, None, true, &[]).unwrap(), ["b", "a"]);
    assert_eq!(downloads::track_ids_for(&conn, None, false, &["a".into(), "a".into()]).unwrap(), ["a"]);
}

#[test]
fn migration_20_adds_the_job_tables_to_an_encrypted_pre_20_library() {
    let (dir, conn) = common::open();
    tracks::upsert(&conn, &common::track("keep", "X"), 1).unwrap();
    conn.execute_batch(common::UNDO_STATS_MIGRATION).unwrap();
    conn.execute_batch("DROP TABLE download_items; DROP TABLE downloads;").unwrap();
    conn.pragma_update(None, "user_version", 19).unwrap();
    drop(conn);

    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 22);
    assert!(tracks::snapshot(&conn, "keep").unwrap().is_some(), "existing rows survive");
    let summary = downloads::create(&conn, &job(&["keep"]), 2).unwrap();
    assert_eq!(summary.total, 1);
    assert!(open_connection(&dir.path().join("library.db"), &[9u8; 32], &dir.path().join("backups")).is_err(), "still encrypted");
}
