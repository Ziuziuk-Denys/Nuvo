//! Music folders and the files found in them. Paths are written only by the daemon's scanner.

use nuvo_contracts::{LocalRelated, LocalRoot, LocalStyle, LocalTrackItem, LocalTracksPage};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use crate::{StoreError, tracks};

pub const MAX_ROOTS: usize = 32;
const MAX_PAGE: usize = 500;

#[derive(Debug, Clone, PartialEq)]
pub struct FileRow {
    pub path: String,
    pub track_id: String,
    pub size_bytes: i64,
    pub mtime_ms: i64,
    pub mime: String,
    pub codec: String,
    pub bitrate_kbps: Option<i64>,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub lossless: bool,
    pub unsupported: Option<String>,
    pub lrc_path: Option<String>,
    pub folder_art: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnownFile {
    pub path: String,
    pub track_id: String,
    pub size_bytes: i64,
    pub mtime_ms: i64,
    pub has_lrc: bool,
    /// `None`: scanned before this was kept, so the file's cover state is unknown.
    pub folder_art: Option<bool>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LocalFile {
    pub row: FileRow,
    pub root_path: String,
}

const ROOT_SELECT: &str = "SELECT r.id, r.path, r.added_at, r.last_scan_at, r.status,
  (SELECT count(*) FROM local_files f WHERE f.root_id = r.id) FROM local_roots r";
/// The listing order as one string, for the row of the track `?3` names (see migration 22).
const SORT_KEY: &str = "(SELECT nuvo_fold(t.artist) || char(31) || nuvo_fold(coalesce(t.album, '')) || char(31)
      || printf('%06d', coalesce(json_extract(t.snapshot_json, '$.local.discNo'), 0)) || char(31)
      || printf('%06d', coalesce(json_extract(t.snapshot_json, '$.local.trackNo'), 0)) || char(31) || nuvo_fold(t.title)
    FROM tracks t WHERE t.id = ?3)";
const SEARCH_KEY: &str = "(SELECT nuvo_fold(t.title) || char(31) || nuvo_fold(t.artist) || char(31) || nuvo_fold(coalesce(t.album, ''))
    FROM tracks t WHERE t.id = ?3)";
const FILE_COLUMNS: &str = "f.path, f.track_id, f.size_bytes, f.mtime_ms, f.mime, f.codec, f.bitrate_kbps, f.sample_rate, f.bit_depth, f.lossless, f.unsupported, f.lrc_path, coalesce(f.folder_art, 0)";

fn root_row(row: &Row) -> rusqlite::Result<LocalRoot> {
    Ok(LocalRoot { id: row.get(0)?, path: row.get(1)?, added_at: row.get(2)?, last_scan_at: row.get(3)?, status: row.get(4)?, files: row.get(5)? })
}

fn file_row(row: &Row) -> rusqlite::Result<FileRow> {
    Ok(FileRow {
        path: row.get(0)?, track_id: row.get(1)?, size_bytes: row.get(2)?, mtime_ms: row.get(3)?, mime: row.get(4)?, codec: row.get(5)?,
        bitrate_kbps: row.get(6)?, sample_rate: row.get(7)?, bit_depth: row.get(8)?, lossless: row.get(9)?, unsupported: row.get(10)?, lrc_path: row.get(11)?, folder_art: row.get(12)?,
    })
}

pub fn roots(conn: &Connection) -> Result<Vec<LocalRoot>, StoreError> {
    let mut stmt = conn.prepare(&format!("{ROOT_SELECT} ORDER BY r.path"))?;
    Ok(stmt.query_map([], root_row)?.collect::<Result<_, _>>()?)
}

pub fn root(conn: &Connection, id: i64) -> Result<Option<LocalRoot>, StoreError> {
    Ok(conn.query_row(&format!("{ROOT_SELECT} WHERE r.id = ?1"), [id], root_row).optional()?)
}

fn inside(parent: &str, child: &str) -> bool {
    child.strip_prefix(parent).is_some_and(|rest| rest.starts_with('/'))
}

/// The same folder again returns it; a folder inside a known one is refused; a folder around
/// known ones takes their files over, so the files keep their track ids.
pub fn add_root(conn: &Connection, path: &str, now: i64) -> Result<LocalRoot, StoreError> {
    let tx = conn.unchecked_transaction()?;
    let existing = roots(&tx)?;
    if let Some(same) = existing.iter().find(|r| r.path == path) {
        return Ok(same.clone());
    }
    if let Some(outer) = existing.iter().find(|r| inside(&r.path, path)) {
        return Err(StoreError::Invalid(format!("this folder is already inside {}", outer.path)));
    }
    let inner: Vec<i64> = existing.iter().filter(|r| inside(path, &r.path)).map(|r| r.id).collect();
    if existing.len() - inner.len() >= MAX_ROOTS {
        return Err(StoreError::Invalid(format!("at most {MAX_ROOTS} music folders")));
    }
    tx.execute("INSERT INTO local_roots (path, added_at, status) VALUES (?1, ?2, 'ok')", params![path, now])?;
    let id = tx.last_insert_rowid();
    for old in inner {
        tx.execute("UPDATE local_files SET root_id = ?1 WHERE root_id = ?2", params![id, old])?;
        tx.execute("DELETE FROM local_roots WHERE id = ?1", [old])?;
    }
    tx.commit()?;
    root(conn, id)?.ok_or(StoreError::NotFound("music folder"))
}

/// File rows go with the folder; `tracks` rows stay, since likes and playlists point at them.
pub fn remove_root(conn: &Connection, id: i64) -> Result<(), StoreError> {
    match conn.execute("DELETE FROM local_roots WHERE id = ?1", [id])? {
        0 => Err(StoreError::NotFound("music folder")),
        _ => Ok(()),
    }
}

pub fn mark_root(conn: &Connection, id: i64, status: &str, scanned_at: Option<i64>) -> Result<(), StoreError> {
    conn.execute(
        "UPDATE local_roots SET status = ?2, last_scan_at = coalesce(?3, last_scan_at) WHERE id = ?1",
        params![id, status, scanned_at],
    )?;
    Ok(())
}

pub fn known_files(conn: &Connection, root_id: i64) -> Result<Vec<KnownFile>, StoreError> {
    let mut stmt = conn.prepare("SELECT path, track_id, size_bytes, mtime_ms, lrc_path IS NOT NULL, folder_art FROM local_files WHERE root_id = ?1")?;
    let rows = stmt.query_map([root_id], |r| {
        Ok(KnownFile { path: r.get(0)?, track_id: r.get(1)?, size_bytes: r.get(2)?, mtime_ms: r.get(3)?, has_lrc: r.get(4)?, folder_art: r.get(5)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// One batch of a scan, in one transaction: new and changed files with their snapshots, then removals.
pub fn apply(conn: &Connection, root_id: i64, rows: &[(FileRow, Value)], removed: &[String], now: i64) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    for (row, snapshot) in rows {
        if tracks::upsert(&tx, snapshot, now)?.id != row.track_id {
            return Err(StoreError::Invalid("snapshot id does not match the file".into()));
        }
        tx.execute(
            &format!("INSERT INTO local_files (path, root_id, track_id, size_bytes, mtime_ms, mime, codec, bitrate_kbps, sample_rate, bit_depth, lossless, unsupported, lrc_path, scanned_at, folder_art, sort_key, search_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, coalesce({SORT_KEY}, ''), coalesce({SEARCH_KEY}, ''))
             ON CONFLICT(path) DO UPDATE SET root_id = excluded.root_id, track_id = excluded.track_id, size_bytes = excluded.size_bytes,
               mtime_ms = excluded.mtime_ms, mime = excluded.mime, codec = excluded.codec, bitrate_kbps = excluded.bitrate_kbps,
               sample_rate = excluded.sample_rate, bit_depth = excluded.bit_depth, lossless = excluded.lossless,
               unsupported = excluded.unsupported, lrc_path = excluded.lrc_path, scanned_at = excluded.scanned_at, folder_art = excluded.folder_art, sort_key = excluded.sort_key, search_key = excluded.search_key"),
            params![row.path, root_id, row.track_id, row.size_bytes, row.mtime_ms, row.mime, row.codec, row.bitrate_kbps, row.sample_rate, row.bit_depth, row.lossless, row.unsupported, row.lrc_path, now, row.folder_art],
        )?;
    }
    for path in removed {
        tx.execute("DELETE FROM local_files WHERE path = ?1 AND root_id = ?2", params![path, root_id])?;
    }
    tx.commit()?;
    Ok(())
}

/// The file to play for a track: the first copy in a reachable folder.
pub fn file_for(conn: &Connection, track_id: &str) -> Result<Option<LocalFile>, StoreError> {
    let sql = format!(
        "SELECT {FILE_COLUMNS}, r.path FROM local_files f JOIN local_roots r ON r.id = f.root_id
         WHERE f.track_id = ?1 AND r.status = 'ok' ORDER BY f.path LIMIT 1"
    );
    Ok(conn.query_row(&sql, [track_id], |r| Ok(LocalFile { row: file_row(r)?, root_path: r.get(13)? })).optional()?)
}

pub fn snapshot_for_path(conn: &Connection, path: &str) -> Result<Option<Value>, StoreError> {
    let raw: Option<String> = conn
        .query_row("SELECT t.snapshot_json FROM local_files f JOIN tracks t ON t.id = f.track_id WHERE f.path = ?1", [path], |r| r.get(0))
        .optional()?;
    raw.as_deref().map(tracks::parse).transpose()
}

fn escape_like(text: &str) -> String {
    text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// A page cursor is the last row's sort key and path, each in hex: the next page continues after it, so
/// a scan writing rows in between cannot shift or repeat anything and a late page costs as much as the first.
fn hex(text: &str) -> String {
    text.bytes().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<String> {
    let bytes: Vec<u8> = (0..text.len() / 2).map(|i| u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok()).collect::<Option<_>>()?;
    String::from_utf8(bytes).ok()
}

/// It also carries the total counted for the first page, so later pages do not count again.
fn encode_cursor(total: i64, sort_key: &str, path: &str) -> String {
    format!("{total}.{}.{}", hex(sort_key), hex(path))
}

fn decode_cursor(cursor: &str) -> Option<(i64, String, String)> {
    let mut parts = cursor.split('.');
    let (total, key, path) = (parts.next()?, parts.next()?, parts.next()?);
    Some((total.parse().ok()?, unhex(key)?, unhex(path)?))
}

/// One row per track (its first copy), in reachable folders, ordered artist, album, disc, track.
pub fn list(conn: &Connection, query: Option<&str>, cursor: Option<&str>, limit: usize) -> Result<LocalTracksPage, StoreError> {
    let limit = limit.clamp(1, MAX_PAGE);
    let after = cursor.map(|c| decode_cursor(c).ok_or_else(|| StoreError::Invalid("bad cursor".into()))).transpose()?;
    let pattern = query.map(str::trim).filter(|q| !q.is_empty()).map(|q| format!("%{}%", escape_like(&q.to_lowercase())));
    let from = "FROM local_files f JOIN local_roots r ON r.id = f.root_id AND r.status = 'ok' JOIN tracks t ON t.id = f.track_id
        WHERE f.path = (SELECT min(g.path) FROM local_files g JOIN local_roots gr ON gr.id = g.root_id AND gr.status = 'ok' WHERE g.track_id = f.track_id)
          AND (?1 IS NULL OR f.search_key LIKE ?1 ESCAPE '\\')";
    let total: i64 = match &after {
        Some((total, ..)) => *total,
        // without a filter the rows are the distinct tracks of reachable folders: no per-row lookups
        None if pattern.is_none() => conn.query_row("SELECT count(DISTINCT f.track_id) FROM local_files f JOIN local_roots r ON r.id = f.root_id AND r.status = 'ok'", [], |r| r.get(0))?,
        None => conn.query_row(&format!("SELECT count(*) {from}"), [&pattern], |r| r.get(0))?,
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT t.snapshot_json, f.codec, f.bitrate_kbps, f.sample_rate, f.bit_depth, f.lossless, f.unsupported, f.lrc_path IS NOT NULL, f.sort_key, f.path {from}
           AND (f.sort_key, f.path) > (?3, ?4)
         ORDER BY f.sort_key, f.path
         LIMIT ?2"
    ))?;
    type Raw = (String, String, Option<i64>, Option<i64>, Option<i64>, bool, Option<String>, bool, String, String);
    // the first page starts after the empty key, so the index is always searched by range
    let (after_key, after_path) = after.map(|(_, key, path)| (key, path)).unwrap_or_default();
    let raws: Vec<Raw> = stmt
        .query_map(params![pattern, limit as i64 + 1, after_key, after_path], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?))
        })?
        .collect::<Result<_, _>>()?;
    let more = raws.len() > limit;
    let mut items = Vec::with_capacity(limit);
    let mut next_cursor = None;
    for (json, codec, bitrate_kbps, sample_rate, bit_depth, lossless, unsupported, has_lyrics, sort_key, path) in raws.into_iter().take(limit) {
        if more {
            next_cursor = Some(encode_cursor(total, &sort_key, &path));
        }
        items.push(LocalTrackItem { track: tracks::parse(&json)?, codec, bitrate_kbps, sample_rate, bit_depth, lossless, unsupported, has_lyrics });
    }
    Ok(LocalTracksPage { items, next_cursor, total })
}

/// The genre tag most of the played and liked local songs carry, as first tagged, and up to
/// `limit` playable local songs of it in random order. No genre while no such song has a tag.
pub fn style(conn: &Connection, limit: usize) -> Result<LocalStyle, StoreError> {
    let genre: Option<String> = conn
        .query_row(
            "SELECT trim(json_extract(t.snapshot_json, '$.local.genre')) AS g FROM tracks t
               JOIN (SELECT track_id FROM play_events UNION ALL SELECT track_id FROM liked_tracks) e ON e.track_id = t.id
             WHERE t.source = 'local' AND g IS NOT NULL AND g != ''
             GROUP BY nuvo_fold(g) ORDER BY count(*) DESC, nuvo_fold(g) LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let Some(genre) = genre else { return Ok(LocalStyle { genre: None, items: Vec::new() }) };
    let mut stmt = conn.prepare(
        "SELECT t.snapshot_json FROM tracks t
         WHERE t.source = 'local'
           AND EXISTS (SELECT 1 FROM local_files f JOIN local_roots r ON r.id = f.root_id AND r.status = 'ok'
                       WHERE f.track_id = t.id AND f.unsupported IS NULL)
           AND nuvo_fold(trim(json_extract(t.snapshot_json, '$.local.genre'))) = nuvo_fold(?1)
         ORDER BY random() LIMIT ?2",
    )?;
    let raws = stmt.query_map(params![genre, limit.clamp(1, 50) as i64], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    let items = raws.iter().map(|raw| tracks::parse(raw)).collect::<Result<_, _>>()?;
    Ok(LocalStyle { genre: Some(genre), items })
}

/// Playable local tracks by the seed's artist first, then of its genre; the seed may be streamed.
pub fn related(conn: &Connection, seed_id: &str, limit: usize) -> Result<LocalRelated, StoreError> {
    let Some(seed) = tracks::snapshot(conn, seed_id)? else { return Ok(LocalRelated { seed: None, items: Vec::new() }) };
    let artist = seed.pointer("/artists/0/name").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let genre = seed.pointer("/local/genre").and_then(Value::as_str).map(str::to_lowercase);
    let mut stmt = conn.prepare(
        "SELECT t.snapshot_json FROM tracks t
         WHERE t.source = 'local' AND t.id != ?1
           AND EXISTS (SELECT 1 FROM local_files f JOIN local_roots r ON r.id = f.root_id AND r.status = 'ok'
                       WHERE f.track_id = t.id AND f.unsupported IS NULL)
           AND (nuvo_fold(t.artist) = ?2 OR (?3 IS NOT NULL AND nuvo_fold(json_extract(t.snapshot_json, '$.local.genre')) = ?3))
         ORDER BY nuvo_fold(t.artist) = ?2 DESC, random() LIMIT ?4",
    )?;
    let raws = stmt
        .query_map(params![seed_id, artist, genre, limit.clamp(1, 50) as i64], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let items = raws.iter().map(|raw| tracks::parse(raw)).collect::<Result<_, _>>()?;
    Ok(LocalRelated { seed: Some(seed), items })
}
