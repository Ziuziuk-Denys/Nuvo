mod common;

use nuvo_store::{MIGRATIONS, StoreError, open_connection, settings};
use serde_json::json;

#[test]
fn creates_an_encrypted_database_at_the_latest_schema() {
    let (dir, conn) = common::open();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 23);
    drop(conn);
    let raw = std::fs::read(dir.path().join("library.db")).unwrap();
    assert!(!raw.starts_with(b"SQLite format 3"), "file header must be encrypted");
}

#[test]
fn wrong_key_is_reported_and_leaves_the_file_intact() {
    let (dir, conn) = common::open();
    settings::set(&conn, "k", &json!(1)).unwrap();
    drop(conn);
    let path = dir.path().join("library.db");
    let before = std::fs::read(&path).unwrap();
    let err = open_connection(&path, &[4u8; 32], &dir.path().join("backups")).unwrap_err();
    assert!(matches!(err, StoreError::WrongKey), "got {err:?}");
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn reopening_keeps_data_and_does_not_back_up_without_a_migration() {
    let (dir, conn) = common::open();
    settings::set(&conn, "k", &json!({"a": 1})).unwrap();
    drop(conn);
    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    assert_eq!(settings::get(&conn, "k").unwrap(), Some(json!({"a": 1})));
    assert_eq!(settings::get(&conn, "missing").unwrap(), None);
    assert!(!dir.path().join("backups").exists());
}

#[test]
fn a_version_8_database_without_served_learned_gets_the_column() {
    let (dir, conn) = common::open();
    conn.execute_batch("ALTER TABLE served DROP COLUMN learned").unwrap();
    drop(conn);
    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    conn.execute("INSERT INTO served (batch_id, track_id, context, served_at) VALUES ('b', 't', 'radio:x', 1)", []).unwrap();
    let learned: i64 = conn.query_row("SELECT learned FROM served", [], |r| r.get(0)).unwrap();
    assert_eq!(learned, 0);
}

#[test]
fn a_database_from_a_newer_build_is_refused() {
    let (dir, conn) = common::open();
    conn.pragma_update(None, "user_version", 99).unwrap();
    drop(conn);
    let err = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap_err();
    assert!(matches!(err, StoreError::TooNew(99)));
}

#[test]
fn ids_look_like_uuid_v4() {
    let id = nuvo_store::new_id();
    assert_eq!(id.len(), 36);
    assert_eq!(&id[14..15], "4");
    assert_ne!(id, nuvo_store::new_id());
}

#[test]
fn backups_are_complete_copies_and_only_the_last_three_are_kept() {
    let (dir, conn) = common::open();
    settings::set(&conn, "k", &json!("v")).unwrap();
    let db_path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    for _ in 0..4 {
        nuvo_store::backup_database(&conn, &db_path, &backups, 1).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let mut names: Vec<_> = std::fs::read_dir(&backups).unwrap().map(|e| e.unwrap().path()).collect();
    names.sort();
    assert_eq!(names.len(), 3);
    let copy = open_connection(names.last().unwrap(), &common::KEY, &dir.path().join("unused")).unwrap();
    assert_eq!(settings::get(&copy, "k").unwrap(), Some(json!("v")), "WAL content must be in the copy");
}

#[tokio::test]
async fn a_panic_inside_a_call_does_not_disable_the_database() {
    let (_dir, conn) = common::open();
    let db = nuvo_store::Db::new(conn);
    let failed = db.call(|_| -> Result<(), StoreError> { panic!("bug in a query") }).await;
    assert!(matches!(failed, Err(StoreError::Task(_))), "got {failed:?}");
    db.call(|c| settings::set(c, "after", &json!(true))).await.unwrap();
    assert_eq!(db.call(|c| settings::get(c, "after")).await.unwrap(), Some(json!(true)));
}

#[test]
fn migration_7_deduplicates_play_events_before_creating_unique_index() {
    let (dir, conn) = common::open();
    let db_path = dir.path().join("library.db");

    conn.execute(
        "INSERT INTO tracks (id, title, artist, artists_json, duration_ms, source, snapshot_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        ["t1", "T", "A", "[]", "1000", "youtube", "{}", "0"],
    ).unwrap();

    conn.execute_batch("DROP INDEX IF EXISTS play_events_idempotent;").unwrap();
    conn.execute_batch(common::UNDO_OWNER_MIGRATIONS).unwrap();
    conn.execute_batch(common::UNDO_RECS_MIGRATION).unwrap();

    for _i in 0..3 {
        conn.execute(
            "INSERT INTO play_events (track_id, session_id, started_at, played_ms, end_reason, hour, weekday)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            ["t1", "s1", "1000", "500", "complete", "10", "3"],
        ).unwrap();
    }

    let count: i64 = conn.query_row("SELECT count(*) FROM play_events", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 3);

    conn.pragma_update(None, "user_version", 6).unwrap();
    drop(conn);

    let conn = open_connection(&db_path, &common::KEY, &dir.path().join("backups")).unwrap();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 23, "migrations 7 to 23 applied");

    let count: i64 = conn.query_row("SELECT count(*) FROM play_events", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1, "duplicates removed, keeping lowest rowid");

    let result = conn.execute(
        "INSERT INTO play_events (track_id, session_id, started_at, played_ms, end_reason, hour, weekday)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        ["t1", "s1", "1000", "600", "complete", "11", "4"],
    );
    assert!(result.is_err(), "unique index prevents duplicates");
}

#[test]
fn a_v1_database_with_playlists_and_duplicate_plays_upgrades_through_every_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let raw = nuvo_store::Connection::open(&path).unwrap();
    raw.execute_batch(&format!("PRAGMA key = \"x'{}'\";", "03".repeat(32))).unwrap();
    raw.execute_batch(MIGRATIONS[0]).unwrap();
    raw.execute_batch(
        "INSERT INTO tracks (id, title, artist, artists_json, duration_ms, source, snapshot_json, updated_at) VALUES ('t1', 'T', 'A', '[]', 1000, 'youtube', '{}', 0);
         INSERT INTO playlists (id, title, created_at, updated_at) VALUES ('p1', 'Mine', 1, 1);
         INSERT INTO play_events (track_id, session_id, started_at, played_ms, end_reason, hour, weekday) VALUES
           ('t1', 's1', 1000, 500, 'complete', 10, 3), ('t1', 's1', 1000, 500, 'complete', 10, 3), ('t1', 's1', 2000, 500, 'complete', 10, 3);
         PRAGMA user_version = 1;",
    )
    .unwrap();
    drop(raw);

    let conn = open_connection(&path, &common::KEY, &dir.path().join("backups")).unwrap();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version as usize, MIGRATIONS.len());
    let events: i64 = conn.query_row("SELECT count(*) FROM play_events", [], |r| r.get(0)).unwrap();
    assert_eq!(events, 2, "the duplicate is gone, the distinct play stays");
    let playlist: (String, String) = conn.query_row("SELECT title, sort_mode FROM playlists WHERE id = 'p1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(playlist, ("Mine".to_string(), "manual".to_string()));
}

#[test]
fn migration_16_notes_existing_pool_lists_as_fetches() {
    let (dir, conn) = common::open();
    conn.execute_batch(common::UNDO_STATS_MIGRATION).unwrap();
    conn.execute_batch("DROP TABLE pool_fetches; PRAGMA user_version = 15;").unwrap();
    conn.execute_batch(
        "INSERT INTO candidate_edges (seed_id, track_id, rank, source, fetched_at) VALUES
           ('s', 'a', 0, 'yt_radio', 5), ('s', 'b', 1, 'yt_radio', 9), ('s', 'c', 0, 'rank', 7);",
    )
    .unwrap();
    drop(conn);
    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    let rows: Vec<(String, String, i64, i64)> = conn
        .prepare("SELECT seed_id, source, fetched_at, stored FROM pool_fetches")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(rows, [("s".to_string(), "yt_radio".to_string(), 9, 2)], "a stored list counts as fresh; ranked evidence does not");
}

fn seed_old_names(conn: &nuvo_store::Connection) {
    conn.execute_batch(
        "INSERT INTO candidate_edges (seed_id, track_id, rank, source, fetched_at) VALUES
           ('s1', 't1', 0, 'youtube-radio', 5), ('s1', 't2', 1, 'youtube-radio', 5), ('s2', 't3', 0, 'soundcloud-radio', 7), ('s3', 't4', 0, 'rank', 9);",
    )
    .unwrap();
}

fn sources(conn: &nuvo_store::Connection, table: &str) -> Vec<(String, String)> {
    let mut stmt = conn.prepare(&format!("SELECT seed_id, source FROM {table} ORDER BY seed_id, source")).unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
}

fn pair(seed: &str, source: &str) -> (String, String) {
    (seed.to_string(), source.to_string())
}

#[test]
fn a_database_before_the_pool_migration_ends_with_current_source_names() {
    let (dir, conn) = common::open();
    conn.execute_batch(common::UNDO_STATS_MIGRATION).unwrap();
    conn.execute_batch("DROP TABLE pool_fetches; DROP TABLE rec_starters;").unwrap();
    seed_old_names(&conn);
    conn.pragma_update(None, "user_version", 15).unwrap();
    drop(conn);
    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    assert_eq!(sources(&conn, "pool_fetches"), [pair("s1", "yt_radio"), pair("s2", "sc_related")]);
    assert_eq!(sources(&conn, "candidate_edges"), [pair("s1", "yt_radio"), pair("s1", "yt_radio"), pair("s2", "sc_related"), pair("s3", "rank")]);
}

#[test]
fn a_database_already_at_16_with_old_source_names_is_renamed_by_17() {
    let (dir, conn) = common::open();
    conn.execute_batch(common::UNDO_STATS_MIGRATION).unwrap();
    conn.execute_batch("DROP TABLE rec_starters;").unwrap();
    seed_old_names(&conn);
    conn.execute_batch(
        "INSERT INTO pool_fetches (seed_id, source, fetched_at, stored) VALUES ('s1', 'youtube-radio', 5, 2), ('s2', 'soundcloud-radio', 7, 1), ('s2', 'sc_related', 8, 1);",
    )
    .unwrap();
    conn.pragma_update(None, "user_version", 16).unwrap();
    drop(conn);
    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    assert_eq!(sources(&conn, "pool_fetches"), [pair("s1", "yt_radio"), pair("s2", "sc_related")]);
    assert_eq!(sources(&conn, "candidate_edges").iter().filter(|(_, s)| s.contains('-')).count(), 0);
}

#[test]
fn opens_a_database_written_by_an_older_sqlcipher() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/library-sqlcipher-4.19.db");
    std::fs::copy(fixture, &path).unwrap();
    let conn = open_connection(&path, &[7u8; 32], &dir.path().join("backups")).unwrap();
    assert_eq!(settings::get(&conn, "fixture").unwrap(), Some(json!({"library": "kept"})));
    let pragma = |name: &str| conn.query_row(&format!("PRAGMA {name}"), [], |r| r.get::<_, String>(0)).unwrap();
    assert_eq!(pragma("cipher_page_size"), "4096");
    assert_eq!(pragma("cipher_kdf_algorithm"), "PBKDF2_HMAC_SHA512");
    assert_eq!(pragma("cipher_hmac_algorithm"), "HMAC_SHA512");
    assert_eq!(pragma("cipher_default_kdf_iter"), "256000");
    assert_eq!(pragma("cipher_plaintext_header_size"), "0");
    assert_eq!(pragma("cipher_use_hmac"), "1");
}
