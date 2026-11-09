use nuvo_contracts::{AddSearch, SearchEntry, iso_from_ms};
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::{StoreError, new_id, tracks};

pub const KEEP: usize = 50;
pub const KINDS: [&str; 5] = ["query", "track", "artist", "album", "playlist"];
const MAX_QUERY_CHARS: usize = 200;
const MAX_ITEM_BYTES: usize = 8 * 1024;
const MAX_ID_LEN: usize = 256;

struct Raw {
    id: String,
    kind: String,
    query: Option<String>,
    item_json: Option<String>,
    at: i64,
}

fn entry_from_row(row: &Row) -> rusqlite::Result<Raw> {
    Ok(Raw { id: row.get("id")?, kind: row.get("kind")?, query: row.get("query")?, item_json: row.get("item_json")?, at: row.get("at")? })
}

fn to_entry(raw: Raw) -> Result<SearchEntry, StoreError> {
    Ok(SearchEntry { id: raw.id, kind: raw.kind, query: raw.query, item: raw.item_json.as_deref().map(tracks::parse).transpose()?, at: iso_from_ms(raw.at) })
}

fn normalise(query: &str) -> String {
    query.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

pub fn add(conn: &Connection, input: &AddSearch, now: i64) -> Result<SearchEntry, StoreError> {
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(StoreError::Invalid(format!("kind must be one of: {}", KINDS.join(", "))));
    }
    let query = input.query.as_deref().map(str::trim).filter(|q| !q.is_empty());
    if query.is_some_and(|q| q.chars().count() > MAX_QUERY_CHARS) {
        return Err(StoreError::Invalid(format!("query is longer than {MAX_QUERY_CHARS} characters")));
    }
    let (key, item_json) = if input.kind == "query" {
        let query = query.ok_or_else(|| StoreError::Invalid("a query entry needs a query".into()))?;
        (format!("query:{}", normalise(query)), None)
    } else {
        let item = input.item.as_ref().ok_or_else(|| StoreError::Invalid("a picked result needs its item".into()))?;
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|id| !id.is_empty() && id.len() <= MAX_ID_LEN)
            .ok_or_else(|| StoreError::Invalid("item needs an id".into()))?;
        let json = item.to_string();
        if json.len() > MAX_ITEM_BYTES {
            return Err(StoreError::Invalid("item snapshot is too large".into()));
        }
        (format!("{}:{id}", input.kind), Some(json))
    };
    let tx = conn.unchecked_transaction()?;
    // Strictly increasing, so entries posted in one millisecond (the localStorage migration) keep their order.
    let at: i64 = tx.query_row("SELECT max(?1, coalesce(max(at) + 1, 0)) FROM search_history", [now], |row| row.get(0))?;
    tx.execute(
        "INSERT INTO search_history (id, kind, dedupe_key, query, item_json, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(dedupe_key) DO UPDATE SET query = excluded.query, item_json = excluded.item_json, at = excluded.at",
        params![new_id(), input.kind, key, query, item_json, at],
    )?;
    tx.execute(
        "DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY at DESC LIMIT ?1)",
        [KEEP as i64],
    )?;
    let row = tx.query_row("SELECT * FROM search_history WHERE dedupe_key = ?1", [key], entry_from_row)?;
    tx.commit()?;
    to_entry(row)
}

pub fn list(conn: &Connection, limit: usize) -> Result<Vec<SearchEntry>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM search_history ORDER BY at DESC LIMIT ?1")?;
    let rows = stmt.query_map([limit.clamp(1, KEEP) as i64], entry_from_row)?.collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(to_entry).collect()
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM search_history WHERE id = ?1", [id])?;
    Ok(())
}

pub fn clear(conn: &Connection) -> Result<(), StoreError> {
    conn.execute("DELETE FROM search_history", [])?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<SearchEntry>, StoreError> {
    let row = conn.query_row("SELECT * FROM search_history WHERE id = ?1", [id], entry_from_row).optional()?;
    row.map(to_entry).transpose()
}
