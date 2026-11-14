mod common;

use std::collections::HashMap;

use nuvo_store::{lyrics_user, open_connection};

#[test]
fn offsets_are_clamped_and_zero_drops_the_row() {
    let (_dir, conn) = common::open();
    assert_eq!(lyrics_user::offset(&conn, "t").unwrap(), 0);
    assert_eq!(lyrics_user::set_offset(&conn, "t", 99_000, 1).unwrap(), 30_000);
    assert_eq!(lyrics_user::offset(&conn, "t").unwrap(), 30_000);
    assert_eq!(lyrics_user::set_offset(&conn, "t", -99_000, 2).unwrap(), -30_000);
    lyrics_user::set_offset(&conn, "t", 0, 3).unwrap();
    let rows: i64 = conn.query_row("SELECT count(*) FROM lyrics_user", [], |r| r.get(0)).unwrap();
    assert_eq!(rows, 0);
}

#[test]
fn zero_keeps_a_row_that_holds_user_lyrics() {
    let (_dir, conn) = common::open();
    conn.execute("INSERT INTO lyrics_user (track_id, format, content, offset_ms) VALUES ('t', 'plain', 'words', 100)", []).unwrap();
    lyrics_user::set_offset(&conn, "t", 0, 3).unwrap();
    let rows: i64 = conn.query_row("SELECT count(*) FROM lyrics_user", [], |r| r.get(0)).unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn import_skips_zeros_and_never_overwrites() {
    let (_dir, conn) = common::open();
    lyrics_user::set_offset(&conn, "b", -200, 1).unwrap();
    let map: HashMap<String, i64> = [("a", 300), ("b", 900), ("c", 0), ("d", 50_000)].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    assert_eq!(lyrics_user::import_offsets(&conn, &map, 2).unwrap(), 2);
    let got: Vec<i64> = ["a", "b", "c", "d"].iter().map(|id| lyrics_user::offset(&conn, id).unwrap()).collect();
    assert_eq!(got, [300, -200, 0, 30_000]);
}

#[test]
fn a_database_from_before_the_migration_gains_the_table_and_keeps_its_data() {
    let (dir, conn) = common::open();
    conn.execute_batch(common::UNDO_STATS_MIGRATION).unwrap();
    conn.execute_batch(
        "DROP TABLE lyrics_user; PRAGMA user_version = 17;
         INSERT INTO tracks (id, title, artist, artists_json, duration_ms, source, snapshot_json, updated_at) VALUES ('t1', 'T', 'A', '[]', 1000, 'youtube', '{}', 0);",
    )
    .unwrap();
    drop(conn);
    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 23);
    let tracks: i64 = conn.query_row("SELECT count(*) FROM tracks", [], |r| r.get(0)).unwrap();
    assert_eq!(tracks, 1);
    assert_eq!(lyrics_user::set_offset(&conn, "t1", 250, 1).unwrap(), 250);
}
