#![allow(dead_code)]

use nuvo_store::{Connection, open_connection};
use serde_json::{Value, json};
use tempfile::TempDir;

pub const KEY: [u8; 32] = [3u8; 32];

pub fn open() -> (TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_connection(&dir.path().join("library.db"), &KEY, &dir.path().join("backups")).unwrap();
    (dir, conn)
}

pub fn track(id: &str, artist: &str) -> Value {
    json!({
        "id": id,
        "title": format!("Title {id}"),
        "artists": [{"id": format!("ar-{artist}"), "name": artist}],
        "album": {"id": format!("al-{artist}"), "title": format!("Album {artist}")},
        "durationMs": 200000,
        "cover": {"url": format!("https://img/{id}.jpg"), "width": 512, "height": 512}
    })
}

/// Undoes migration 8 (recommendations), for tests that rebuild an older schema and migrate again.
pub const UNDO_RECS_MIGRATION: &str = "
ALTER TABLE play_events DROP COLUMN seek_forward_ms;
DROP TABLE track_keys;
DROP TABLE suppressions;
DROP TABLE candidate_edges;
DROP TABLE served;
DROP TABLE track_features;
DROP TABLE taste_excluded;
DROP TABLE rec_model;
";

/// Undoes migration 21 (statistics).
pub const UNDO_STATS_MIGRATION: &str = "
DROP INDEX play_events_started;
ALTER TABLE play_events DROP COLUMN tz_offset_min;
ALTER TABLE play_events DROP COLUMN source;
";

/// Undoes the migrations (9 on), newest first, for tests that rebuild an older schema.
pub const UNDO_OWNER_MIGRATIONS: &str = "
DROP INDEX play_events_started;
ALTER TABLE play_events DROP COLUMN tz_offset_min;
ALTER TABLE play_events DROP COLUMN source;
DROP TABLE import_rows;
DROP TABLE imports;
DROP INDEX playlist_items_track;
DROP TABLE library_flags;
DROP TABLE search_history;
";
