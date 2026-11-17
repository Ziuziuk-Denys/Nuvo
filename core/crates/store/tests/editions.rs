mod common;

use std::path::Path;

use nuvo_contracts::CreatePlaylist;
use nuvo_store::settings::{self, Secrets};
use nuvo_store::{Connection, MIGRATIONS, StoreError, convert_database, library, open_connection, open_library, opens_with, playlists};
use serde_json::json;

const MASTER: [u8; 32] = [6u8; 32];

fn fill(conn: &Connection) {
    library::like(conn, "t1", Some(common::track("t1", "A")), 1).unwrap();
    playlists::create(conn, &CreatePlaylist { title: "Road".into(), description: None, is_public: false }, 2).unwrap();
    settings::set(conn, settings::DISPLAY_NAME, &json!("Den")).unwrap();
}

fn check(conn: &Connection) {
    assert_eq!(library::liked_ids(conn).unwrap(), vec!["t1".to_string()]);
    assert_eq!(playlists::list(conn).unwrap().iter().map(|p| p.title.as_str()).collect::<Vec<_>>(), vec!["Road"]);
    assert_eq!(settings::get(conn, settings::DISPLAY_NAME).unwrap(), Some(json!("Den")));
}

fn header(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()[..16].to_vec()
}

#[test]
fn an_encrypted_library_turns_plain_with_everything_in_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    fill(&open_library(&path, Some(&MASTER), &backups).unwrap());
    assert!(!opens_with(&path, None) && opens_with(&path, Some(&MASTER)));

    convert_database(&path, Some(&MASTER), None, &backups).unwrap();

    assert!(opens_with(&path, None) && !opens_with(&path, Some(&MASTER)));
    assert_eq!(header(&path), b"SQLite format 3\0");
    let conn = open_library(&path, None, &backups).unwrap();
    check(&conn);
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version as usize, MIGRATIONS.len());
    assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 1, "the encrypted original is kept as a backup");
    assert!(!dir.path().join("library.next").exists());
}

#[test]
fn a_plain_library_turns_encrypted_with_everything_in_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    fill(&open_library(&path, None, &backups).unwrap());
    assert!(opens_with(&path, None) && !opens_with(&path, Some(&MASTER)));

    convert_database(&path, None, Some(&MASTER), &backups).unwrap();

    assert!(!opens_with(&path, None) && opens_with(&path, Some(&MASTER)));
    check(&open_library(&path, Some(&MASTER), &backups).unwrap());
    assert!(matches!(open_library(&path, None, &backups), Err(StoreError::WrongKey)));
}

#[test]
fn a_wrong_key_converts_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    drop(open_connection(&path, &[1u8; 32], &backups).unwrap());
    let before = std::fs::read(&path).unwrap();
    assert!(matches!(convert_database(&path, Some(&MASTER), None, &backups), Err(StoreError::WrongKey)));
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn secrets_in_a_plain_library_are_sealed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    let conn = &open_library(&path, None, &backups).unwrap();
    let loads = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = loads.clone();
    let sealed = Secrets::sealed(move || {
        counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(MASTER)
    });

    settings::set_secret(conn, &sealed, settings::LASTFM_SESSION_KEY, &json!("session-123")).unwrap();
    settings::set_secret(conn, &sealed, settings::YOUTUBE_SESSION, &json!({"refreshToken": "rt-456"})).unwrap();

    let raw: String = conn.query_row("SELECT group_concat(value_json) FROM settings_kv", [], |r| r.get(0)).unwrap();
    assert!(!raw.contains("session-123") && !raw.contains("rt-456"), "stored in clear: {raw}");
    assert_eq!(settings::get_secret(conn, &sealed, settings::LASTFM_SESSION_KEY).unwrap(), Some(json!("session-123")));
    assert_eq!(settings::get_secret(conn, &sealed, settings::YOUTUBE_SESSION).unwrap(), Some(json!({"refreshToken": "rt-456"})));
    assert_eq!(loads.load(std::sync::atomic::Ordering::SeqCst), 1, "the key is fetched once");

    settings::set_secret(conn, &sealed, settings::LASTFM_SESSION_KEY, &serde_json::Value::Null).unwrap();
    assert_eq!(settings::get(conn, settings::LASTFM_SESSION_KEY).unwrap(), Some(serde_json::Value::Null));

    settings::reseal(conn, &sealed, &Secrets::Clear).unwrap();
    assert_eq!(settings::get(conn, settings::YOUTUBE_SESSION).unwrap(), Some(json!({"refreshToken": "rt-456"})));
}

#[test]
fn a_plain_library_without_secrets_never_asks_for_the_key() {
    let (_dir, conn) = common::open();
    let sealed = Secrets::sealed(|| panic!("no secret was read or written"));
    assert_eq!(settings::get_secret(&conn, &sealed, settings::LASTFM_SESSION_KEY).unwrap(), None);
    settings::reseal(&conn, &Secrets::Clear, &sealed).unwrap();
}

#[test]
fn an_encrypted_library_left_with_its_wal_is_known_as_encrypted_and_converts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let backups = dir.path().join("backups");
    let conn = open_library(&path, Some(&MASTER), &backups).unwrap();
    fill(&conn);
    // the daemon leaves through process::exit, which closes nothing
    std::mem::forget(conn);

    assert!(!opens_with(&path, None));
    assert!(opens_with(&path, Some(&MASTER)));
    convert_database(&path, Some(&MASTER), None, &backups).unwrap();
    check(&open_library(&path, None, &backups).unwrap());
}
