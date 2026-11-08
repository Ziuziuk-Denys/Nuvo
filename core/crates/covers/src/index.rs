//! The cover index in the library database (store migration 14). The files themselves live in
//! the encrypted cache, named by the cache key.

use nuvo_store::{Connection, StoreError, settings};
use rusqlite::{OptionalExtension, Row};

pub const LIMIT_KEY: &str = "covers_limit_bytes";
pub const DEFAULT_LIMIT_BYTES: i64 = 200 * 1024 * 1024;
pub const MIN_LIMIT_BYTES: i64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub key: String,
    pub source: String,
    pub bucket: u32,
    pub content_type: String,
    pub size_bytes: i64,
}

fn entry(row: &Row) -> rusqlite::Result<Entry> {
    Ok(Entry { key: row.get("cache_key")?, source: row.get("source")?, bucket: row.get("bucket")?, content_type: row.get("content_type")?, size_bytes: row.get("size_bytes")? })
}

pub fn get(conn: &Connection, key: &str) -> Result<Option<Entry>, StoreError> {
    Ok(conn.query_row("SELECT * FROM cover_entries WHERE cache_key = ?1", [key], entry).optional()?)
}

pub fn upsert(conn: &Connection, e: &Entry, now: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO cover_entries (cache_key, source, bucket, content_type, size_bytes, created_at, last_served_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(cache_key) DO UPDATE SET content_type = excluded.content_type, size_bytes = excluded.size_bytes, last_served_at = excluded.last_served_at",
        (&e.key, &e.source, e.bucket, &e.content_type, e.size_bytes, now),
    )?;
    Ok(())
}

pub fn touch(conn: &Connection, key: &str, now: i64) -> Result<(), StoreError> {
    conn.execute("UPDATE cover_entries SET last_served_at = ?2 WHERE cache_key = ?1", (key, now))?;
    Ok(())
}

pub fn delete(conn: &Connection, key: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM cover_entries WHERE cache_key = ?1", [key])?;
    Ok(())
}

/// Every cached bucket of one cover.
pub fn for_source(conn: &Connection, source: &str) -> Result<Vec<Entry>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM cover_entries WHERE source = ?1 ORDER BY bucket")?;
    Ok(stmt.query_map([source], entry)?.collect::<Result<_, _>>()?)
}

/// Least recently served first.
pub fn by_last_served(conn: &Connection) -> Result<Vec<Entry>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM cover_entries ORDER BY last_served_at, created_at")?;
    Ok(stmt.query_map([], entry)?.collect::<Result<_, _>>()?)
}

/// `(bytes, count)`, exact.
pub fn totals(conn: &Connection) -> Result<(i64, i64), StoreError> {
    Ok(conn.query_row("SELECT coalesce(sum(size_bytes), 0), count(*) FROM cover_entries", [], |r| Ok((r.get(0)?, r.get(1)?)))?)
}

/// The stored limit as set (0 means unlimited).
pub fn stored_limit(conn: &Connection) -> Result<i64, StoreError> {
    Ok(settings::get(conn, LIMIT_KEY)?.and_then(|v| v.as_i64()).unwrap_or(DEFAULT_LIMIT_BYTES))
}
