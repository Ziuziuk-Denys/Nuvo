#![allow(dead_code)]

use nuvo_store::{Connection, open_connection, tracks};
use serde_json::{Value, json};
use tempfile::TempDir;

pub const DAY: i64 = 86_400_000;
pub const NOW: i64 = 1_000 * DAY;

pub fn open() -> (TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_connection(&dir.path().join("library.db"), &[7u8; 32], &dir.path().join("backups")).unwrap();
    (dir, conn)
}

/// A database on a real disk under ~/.cache (the default temp dir is often tmpfs, where commits cost nothing).
pub fn open_on_disk() -> (TempDir, Connection) {
    let base = std::path::PathBuf::from(std::env::var("HOME").unwrap()).join(".cache/nuvo-tests");
    std::fs::create_dir_all(&base).unwrap();
    let dir = tempfile::tempdir_in(base).unwrap();
    let conn = open_connection(&dir.path().join("library.db"), &[7u8; 32], &dir.path().join("backups")).unwrap();
    (dir, conn)
}

pub fn snapshot(id: &str, title: &str, artist: &str) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": artist, "name": artist}], "durationMs": 200000})
}

pub fn track(conn: &Connection, id: &str, title: &str, artist: &str) {
    tracks::upsert(conn, &snapshot(id, title, artist), NOW - 400 * DAY).unwrap();
}

pub fn play(conn: &Connection, id: &str, artist: &str, session: &str, started_at: i64, extra: Value) {
    let mut body = json!({
        "listeningSessionId": session, "trackId": id, "trackSnapshot": snapshot(id, &format!("Song {id}"), artist),
        "playedDurationMs": 200000, "trackDurationMs": 200000, "completed": true, "startedAt": started_at
    });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    let event: nuvo_contracts::RecordPlaybackEvent = serde_json::from_value(body).unwrap();
    nuvo_store::events::record(conn, &event, started_at + 1000).unwrap();
}

pub fn skip(ms: i64) -> Value {
    json!({"completed": false, "endReason": "skip", "playedDurationMs": ms})
}
