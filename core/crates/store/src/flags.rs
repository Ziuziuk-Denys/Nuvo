//! Pins and hides for playlists, albums and artists. No cap on pins; a hidden item leaves Home and
//! the Library lists but stays playable by link, in search and in history.

use std::collections::HashSet;

use nuvo_contracts::{FlagKey, LibraryFlag, SetFlag, iso_from_ms};
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::{StoreError, tracks};

pub const KINDS: [&str; 3] = ["playlist", "album", "artist"];
const MAX_ID_LEN: usize = 256;
const MAX_SNAPSHOT_BYTES: usize = 16 * 1024;

/// A row before its snapshot JSON is parsed.
struct Raw {
    kind: String,
    id: String,
    pinned: bool,
    hidden: bool,
    snapshot_json: Option<String>,
    updated_at: i64,
}

fn raw_from_row(row: &Row) -> rusqlite::Result<Raw> {
    Ok(Raw {
        kind: row.get("kind")?,
        id: row.get("id")?,
        pinned: row.get::<_, Option<f64>>("pinned_position")?.is_some(),
        hidden: row.get("hidden")?,
        snapshot_json: row.get("snapshot_json")?,
        updated_at: row.get("updated_at")?,
    })
}

fn to_flag(raw: Raw) -> Result<LibraryFlag, StoreError> {
    Ok(LibraryFlag {
        kind: raw.kind,
        id: raw.id,
        pinned: raw.pinned,
        hidden: raw.hidden,
        snapshot: raw.snapshot_json.as_deref().map(tracks::parse).transpose()?,
        updated_at: iso_from_ms(raw.updated_at),
    })
}

fn check_key(kind: &str, id: &str) -> Result<(), StoreError> {
    if !KINDS.contains(&kind) {
        return Err(StoreError::Invalid(format!("kind must be one of: {}", KINDS.join(", "))));
    }
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err(StoreError::Invalid("bad id".into()));
    }
    Ok(())
}

/// Pinned items first in pin order, then hidden ones, newest change first.
pub fn list(conn: &Connection) -> Result<Vec<LibraryFlag>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT * FROM library_flags ORDER BY pinned_position IS NULL, pinned_position, updated_at DESC, kind, id",
    )?;
    let rows = stmt.query_map([], raw_from_row)?.collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(to_flag).collect()
}

fn get(conn: &Connection, kind: &str, id: &str) -> Result<Option<LibraryFlag>, StoreError> {
    let raw = conn.query_row("SELECT * FROM library_flags WHERE kind = ?1 AND id = ?2", params![kind, id], raw_from_row).optional()?;
    raw.map(to_flag).transpose()
}

/// Pinning appends to the end and unhides; hiding unpins. A row left neither pinned nor hidden
/// is removed. Returns the item's state afterwards.
pub fn set(conn: &Connection, kind: &str, id: &str, input: &SetFlag, now: i64) -> Result<LibraryFlag, StoreError> {
    check_key(kind, id)?;
    if input.pinned == Some(true) && input.hidden == Some(true) {
        return Err(StoreError::Invalid("an item cannot be pinned and hidden at once".into()));
    }
    let snapshot = match &input.snapshot {
        Some(value) if !value.is_object() => return Err(StoreError::Invalid("snapshot must be an object".into())),
        Some(value) if value.to_string().len() > MAX_SNAPSHOT_BYTES => return Err(StoreError::Invalid("snapshot is too large".into())),
        Some(value) => Some(value.to_string()),
        None => None,
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO library_flags (kind, id, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(kind, id) DO NOTHING",
        params![kind, id, now],
    )?;
    if let Some(json) = &snapshot {
        tx.execute("UPDATE library_flags SET snapshot_json = ?3 WHERE kind = ?1 AND id = ?2", params![kind, id, json])?;
    }
    match input.pinned {
        Some(true) => {
            tx.execute(
                "UPDATE library_flags SET hidden = 0, pinned_position = coalesce(pinned_position,
                   (SELECT coalesce(max(pinned_position), 0) + 1 FROM library_flags)) WHERE kind = ?1 AND id = ?2",
                params![kind, id],
            )?;
        }
        Some(false) => {
            tx.execute("UPDATE library_flags SET pinned_position = NULL WHERE kind = ?1 AND id = ?2", params![kind, id])?;
        }
        None => {}
    }
    match input.hidden {
        Some(true) => {
            tx.execute("UPDATE library_flags SET hidden = 1, pinned_position = NULL WHERE kind = ?1 AND id = ?2", params![kind, id])?;
        }
        Some(false) => {
            tx.execute("UPDATE library_flags SET hidden = 0 WHERE kind = ?1 AND id = ?2", params![kind, id])?;
        }
        None => {}
    }
    tx.execute("UPDATE library_flags SET updated_at = ?3 WHERE kind = ?1 AND id = ?2", params![kind, id, now])?;
    let flag = get(&tx, kind, id)?.expect("the row was just written");
    tx.execute(
        "DELETE FROM library_flags WHERE kind = ?1 AND id = ?2 AND pinned_position IS NULL AND hidden = 0",
        params![kind, id],
    )?;
    tx.commit()?;
    Ok(flag)
}

pub fn delete(conn: &Connection, kind: &str, id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM library_flags WHERE kind = ?1 AND id = ?2", params![kind, id])?;
    Ok(())
}

/// Puts `items` first, in this order; pinned items not listed follow in their old order.
/// Every listed item must be pinned, and none may repeat.
pub fn pin_order(conn: &Connection, items: &[FlagKey]) -> Result<Vec<LibraryFlag>, StoreError> {
    let mut seen = HashSet::new();
    if !items.iter().all(|key| seen.insert((key.kind.as_str(), key.id.as_str()))) {
        return Err(StoreError::Invalid("an item is listed twice".into()));
    }
    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare("SELECT kind, id FROM library_flags WHERE pinned_position IS NOT NULL ORDER BY pinned_position")?;
    let pinned = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    if let Some(key) = items.iter().find(|key| !pinned.iter().any(|(k, i)| *k == key.kind && *i == key.id)) {
        return Err(StoreError::Invalid(format!("{} {} is not pinned", key.kind, key.id)));
    }
    let rest = pinned.iter().filter(|(k, i)| !seen.contains(&(k.as_str(), i.as_str())));
    let order = items.iter().map(|key| (key.kind.as_str(), key.id.as_str())).chain(rest.map(|(k, i)| (k.as_str(), i.as_str())));
    for (index, (kind, id)) in order.enumerate() {
        tx.execute("UPDATE library_flags SET pinned_position = ?3 WHERE kind = ?1 AND id = ?2", params![kind, id, index as f64 + 1.0])?;
    }
    let flags = list(&tx)?;
    tx.commit()?;
    Ok(flags)
}
