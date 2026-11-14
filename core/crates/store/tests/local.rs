mod common;

use nuvo_store::{open_connection, tracks};
use rusqlite::params;
use serde_json::json;

const LOCAL_ID: &str = "local:0123456789abcdef0123456789abcdef";

const UNDO_LOCAL_MIGRATION: &str = "
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS local_files;
DROP TABLE IF EXISTS local_roots;
CREATE TABLE tracks_old (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, artists_json TEXT NOT NULL, album TEXT, album_id TEXT,
  duration_ms INTEGER NOT NULL, cover_url TEXT, source TEXT NOT NULL CHECK (source IN ('youtube', 'soundcloud')),
  snapshot_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO tracks_old SELECT * FROM tracks;
DROP TABLE tracks;
ALTER TABLE tracks_old RENAME TO tracks;
";

#[test]
fn migration_19_takes_local_tracks_and_keeps_rows_and_links() {
    let (dir, conn) = common::open();
    tracks::upsert(&conn, &common::track("yt1", "A"), 1).unwrap();
    conn.execute("INSERT INTO liked_tracks (track_id, liked_at) VALUES ('yt1', 5)", []).unwrap();
    conn.execute_batch(common::UNDO_STATS_MIGRATION).unwrap();
    conn.execute_batch(UNDO_LOCAL_MIGRATION).unwrap();
    assert!(conn.execute("INSERT INTO tracks (id, title, artist, artists_json, duration_ms, source, snapshot_json, updated_at) VALUES ('l', 'T', 'A', '[]', 1, 'local', '{}', 0)", []).is_err(), "the old schema refuses local");
    conn.pragma_update(None, "user_version", 18).unwrap();
    drop(conn);

    let conn = open_connection(&dir.path().join("library.db"), &common::KEY, &dir.path().join("backups")).unwrap();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 23);
    let liked: String = conn.query_row("SELECT track_id FROM liked_tracks", [], |r| r.get(0)).unwrap();
    assert_eq!(liked, "yt1");
    let broken: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
    assert_eq!(broken, 0);
    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1, "foreign keys are on again after migrating");

    let snapshot = json!({"id": LOCAL_ID, "title": "Mine", "artists": [{"id": "", "name": "Me"}], "durationMs": 1000});
    assert_eq!(tracks::upsert(&conn, &snapshot, 2).unwrap().source, "local");
    let err = conn.execute("INSERT INTO local_files (path, root_id, track_id, size_bytes, mtime_ms, mime, codec, scanned_at) VALUES ('/x', 99, 'nope', 1, 1, 'a', 'b', 1)", []);
    assert!(err.is_err(), "local_files rows need a root and a track");
}

use nuvo_store::local::{self, FileRow};
use nuvo_store::{cache_index, playlists};
use serde_json::Value;

fn row(path: &str, id: &str) -> FileRow {
    FileRow {
        path: path.into(), track_id: id.into(), size_bytes: 10, mtime_ms: 1, mime: "audio/flac".into(), codec: "flac".into(),
        bitrate_kbps: Some(900), sample_rate: Some(44100), bit_depth: Some(16), lossless: true, unsupported: None, lrc_path: None, folder_art: false,
    }
}

fn local_snapshot(id: &str, title: &str, artist: &str, genre: &str) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "", "name": artist}], "durationMs": 1000, "local": {"genre": genre}})
}

fn lid(n: u8) -> String {
    format!("local:{}", format!("{n:x}").repeat(32).chars().take(32).collect::<String>())
}

#[test]
fn roots_nest_by_rules() {
    let (_dir, conn) = common::open();
    let music = local::add_root(&conn, "/home/u/Music", 1).unwrap();
    assert_eq!(local::add_root(&conn, "/home/u/Music", 2).unwrap().id, music.id, "same folder twice is one folder");
    assert!(local::add_root(&conn, "/home/u/Music/Rock", 3).is_err(), "inside a known folder");
    assert!(local::add_root(&conn, "/home/u/Musical", 3).is_ok(), "a sibling with a shared prefix is fine");
    local::apply(&conn, music.id, &[(row("/home/u/Music/a.flac", &lid(1)), local_snapshot(&lid(1), "A", "X", "rock"))], &[], 4).unwrap();
    let home = local::add_root(&conn, "/home/u", 5).unwrap();
    let roots = local::roots(&conn).unwrap();
    assert_eq!(roots.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), ["/home/u"], "the outer folder took both over");
    assert_eq!(roots[0].files, 1);
    assert_eq!(local::file_for(&conn, &lid(1)).unwrap().unwrap().root_path, "/home/u");
    local::remove_root(&conn, home.id).unwrap();
    assert!(local::file_for(&conn, &lid(1)).unwrap().is_none());
    assert!(nuvo_store::tracks::snapshot(&conn, &lid(1)).unwrap().is_some(), "the track stays for likes and playlists");
}

#[test]
fn files_list_search_and_hide_missing_folders() {
    let (_dir, conn) = common::open();
    let root = local::add_root(&conn, "/m", 1).unwrap();
    let rows = vec![
        (row("/m/1.flac", &lid(1)), local_snapshot(&lid(1), "Кино Song", "Band", "rock")),
        (row("/m/2.flac", &lid(2)), local_snapshot(&lid(2), "Other", "Artist", "jazz")),
    ];
    local::apply(&conn, root.id, &rows, &[], 2).unwrap();
    assert_eq!(local::known_files(&conn, root.id).unwrap().len(), 2);
    let page = local::list(&conn, None, None, 1).unwrap();
    assert_eq!((page.total, page.items.len(), page.next_cursor.is_some()), (2, 1, true));
    assert_eq!(page.items[0].track["artists"][0]["name"], "Artist", "ordered by artist");
    let next = local::list(&conn, None, page.next_cursor.as_deref(), 1).unwrap();
    assert_eq!((next.total, next.items.len(), next.next_cursor), (2, 1, None), "the cursor continues after the first row");
    assert_eq!(next.items[0].track["artists"][0]["name"], "Band");
    assert_eq!(local::list(&conn, Some("кино"), None, 50).unwrap().items.len(), 1, "search folds Cyrillic case");
    assert_eq!(local::list(&conn, Some("100%"), None, 50).unwrap().total, 0, "LIKE wildcards are literal");
    local::apply(&conn, root.id, &[], &["/m/2.flac".to_string()], 3).unwrap();
    assert_eq!(local::list(&conn, None, None, 50).unwrap().total, 1);
    local::mark_root(&conn, root.id, "missing", None).unwrap();
    assert_eq!(local::list(&conn, None, None, 50).unwrap().total, 0);
    assert!(local::file_for(&conn, &lid(1)).unwrap().is_none());
    assert_eq!(local::known_files(&conn, root.id).unwrap().len(), 1, "rows stay while the folder is missing");
}

#[test]
fn related_finds_same_artist_then_genre() {
    let (_dir, conn) = common::open();
    let root = local::add_root(&conn, "/m", 1).unwrap();
    let rows = vec![
        (row("/m/1.flac", &lid(1)), local_snapshot(&lid(1), "One", "Band", "rock")),
        (row("/m/2.flac", &lid(2)), local_snapshot(&lid(2), "Two", "band", "pop")),
        (row("/m/3.flac", &lid(3)), local_snapshot(&lid(3), "Three", "Else", "rock")),
        (row("/m/4.flac", &lid(4)), local_snapshot(&lid(4), "Four", "Else", "jazz")),
    ];
    local::apply(&conn, root.id, &rows, &[], 2).unwrap();
    let related = local::related(&conn, &lid(1), 10).unwrap();
    let ids: Vec<&str> = related.items.iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0], lid(2), "same artist first");
    assert_eq!(ids[1], lid(3), "then same genre");
    assert_eq!(related.seed.unwrap()["id"], lid(1).as_str());
    nuvo_store::tracks::upsert(&conn, &common::track("yt1", "Band"), 3).unwrap();
    assert_eq!(local::related(&conn, "yt1", 10).unwrap().items.len(), 2, "a streamed seed finds local tracks by artist");
    assert!(local::related(&conn, "nope", 10).unwrap().seed.is_none());
}

#[test]
fn style_is_the_genre_played_and_liked_most_with_its_songs() {
    let (_dir, conn) = common::open();
    assert_eq!(local::style(&conn, 10).unwrap().genre, None, "no songs, no genre");
    let root = local::add_root(&conn, "/m", 1).unwrap();
    let rows = vec![
        (row("/m/1.flac", &lid(1)), local_snapshot(&lid(1), "One", "Band", "Shoegaze")),
        (row("/m/2.flac", &lid(2)), local_snapshot(&lid(2), "Two", "Else", "shoegaze ")),
        (row("/m/3.flac", &lid(3)), local_snapshot(&lid(3), "Three", "Else", "Jazz")),
        (row("/m/4.flac", &lid(4)), local_snapshot(&lid(4), "Four", "Other", "")),
    ];
    local::apply(&conn, root.id, &rows, &[], 2).unwrap();
    assert_eq!(local::style(&conn, 10).unwrap().genre, None, "tags alone are not taste");
    let play = |id: &str, at: i64| {
        conn.execute(
            "INSERT INTO play_events (track_id, session_id, started_at, played_ms, end_reason, hour, weekday) VALUES (?1, 's', ?2, 60000, 'complete', 1, 1)",
            params![id, at],
        )
        .unwrap()
    };
    play(&lid(3), 1);
    play(&lid(4), 2);
    play(&lid(4), 3);
    conn.execute("INSERT INTO liked_tracks (track_id, liked_at) VALUES (?1, 5), (?2, 5)", [lid(1), lid(2)]).unwrap();
    let style = local::style(&conn, 10).unwrap();
    assert_eq!(style.genre.as_deref().map(str::to_lowercase).as_deref(), Some("shoegaze"), "two likes beat one play; untagged songs never count");
    let mut ids: Vec<&str> = style.items.iter().map(|t| t["id"].as_str().unwrap()).collect();
    ids.sort_unstable();
    assert_eq!(ids, [lid(1), lid(2)], "every song of the genre, any case or spacing");
    assert_eq!(local::style(&conn, 1).unwrap().items.len(), 1);
}

#[test]
fn local_tracks_are_never_prefetched_and_count_as_offline() {
    let (_dir, conn) = common::open();
    let root = local::add_root(&conn, "/m", 1).unwrap();
    local::apply(&conn, root.id, &[(row("/m/1.flac", &lid(1)), local_snapshot(&lid(1), "One", "Band", "rock"))], &[], 2).unwrap();
    conn.execute("INSERT INTO liked_tracks (track_id, liked_at) VALUES (?1, 5)", [lid(1)]).unwrap();
    assert!(cache_index::missing_keep_tracks(&conn, 10).unwrap().is_empty());
    let playlist = playlists::create(&conn, &serde_json::from_value(json!({"title": "Mix"})).unwrap(), 3).unwrap();
    playlists::add_track(&conn, &playlist.id, &lid(1), None, 4).unwrap();
    let progress = playlists::offline_progress(&conn, &playlist.id).unwrap();
    assert_eq!((progress.cached, progress.total), (1, 1));
    assert_eq!(local::snapshot_for_path(&conn, "/m/1.flac").unwrap().unwrap()["id"], lid(1).as_str());
}
