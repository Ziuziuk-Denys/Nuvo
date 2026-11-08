use std::collections::{HashMap, HashSet};

use nuvo_contracts::{
    BulkAddResult, CoverSnapshot, CreatePlaylist, InsertItem, MergePlaylists, MergeResult, OfflineProgress, PlaylistItemsPage, PlaylistListItem, PlaylistSnapshot, PlaylistWithItems,
    RemoveResult, TrackFields, TransferMode, TransferResult, UpdatePlaylist, UserPlaylist, UserPlaylistItem, iso_from_ms, ms_from_iso, with_viewer,
};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use nuvo_crypto::{base64_decode, base64_encode};

use crate::{StoreError, new_id, tracks};

const MAX_TITLE_CHARS: usize = 200;
const MAX_BULK_TRACKS: usize = 5000;
/// Below this gap two neighbours are renumbered instead of being split again.
const MIN_GAP: f64 = 1e-6;
pub const SORT_MODES: [&str; 6] = ["manual", "added", "title", "artist", "album", "duration"];
pub const PAGE_DEFAULT: usize = 500;
pub const PAGE_MAX: usize = 1000;
/// Same limit as the cover route: the renderer encodes 600 x 600 WebP well below it.
const MAX_COVER_BYTES: usize = 400 * 1024;
const COVER_MIMES: [&str; 3] = ["image/webp", "image/jpeg", "image/png"];
/// Every playlist read joins the cover's timestamp so `coverUrl` changes when the cover does.
const PLAYLIST_SELECT: &str =
    "SELECT p.*, c.updated_at AS cover_updated_at FROM playlists p LEFT JOIN playlist_covers c ON c.playlist_id = p.id";

fn playlist_from_row(row: &Row) -> rusqlite::Result<UserPlaylist> {
    let id: String = row.get("id")?;
    let cover_url = row
        .get::<_, Option<i64>>("cover_updated_at")?
        .map(|v| format!("nuvo-core://local/v1/me/playlists/{id}/cover?v={v}"));
    Ok(UserPlaylist {
        id,
        title: row.get("title")?,
        description: row.get("description")?,
        is_public: row.get("is_public")?,
        pinned_offline: row.get("pinned_offline")?,
        created_at: iso_from_ms(row.get("created_at")?),
        updated_at: iso_from_ms(row.get("updated_at")?),
        revision: row.get("revision")?,
        owner_id: "local",
        sort_mode: row.get("sort_mode")?,
        sort_desc: row.get("sort_desc")?,
        cover_url,
    })
}

fn clean_title(title: &str) -> Result<String, StoreError> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(StoreError::Invalid(format!("title must be 1-{MAX_TITLE_CHARS} characters")));
    }
    Ok(title.to_string())
}

/// Sort keys of a stored mode, most significant first, as `(expression, descending)`. Every list
/// ends in the manual order and the item id, so no two rows tie and a cursor marks one exact place;
/// tracks without an album go last in both directions.
fn sort_keys(mode: &str, desc: bool) -> Vec<(&'static str, bool)> {
    let mut keys = match mode {
        "added" => vec![("i.added_at", desc)],
        "title" => vec![("t.title COLLATE NOCASE", desc)],
        "artist" => vec![("t.artist COLLATE NOCASE", desc)],
        "album" => vec![("(t.album IS NULL)", false), ("coalesce(t.album, '') COLLATE NOCASE", desc)],
        "duration" => vec![("t.duration_ms", desc)],
        _ => Vec::new(),
    };
    keys.extend([("i.position", false), ("i.added_at", false), ("i.id", false)]);
    keys
}

/// ORDER BY for a stored sort mode.
fn order_by(mode: &str, desc: bool) -> String {
    sort_keys(mode, desc).iter().map(|(expr, desc)| format!("{expr} {}", if *desc { "DESC" } else { "ASC" })).collect::<Vec<_>>().join(", ")
}

/// Rows after the cursor row in the keys' own directions: `k1 > v1 OR (k1 = v1 AND (k2 > v2 OR ...))`,
/// with the cursor's values bound from `?first` on.
fn after_cursor(keys: &[(&str, bool)], first: usize) -> String {
    let mut clause = String::new();
    for (index, (expr, desc)) in keys.iter().enumerate().rev() {
        let (op, n) = (if *desc { "<" } else { ">" }, first + index);
        clause = if clause.is_empty() { format!("{expr} {op} ?{n}") } else { format!("{expr} {op} ?{n} OR ({expr} = ?{n} AND ({clause}))") };
    }
    clause
}

pub fn list(conn: &Connection) -> Result<Vec<UserPlaylist>, StoreError> {
    let mut stmt = conn.prepare(&format!("{PLAYLIST_SELECT} ORDER BY p.updated_at DESC, p.id"))?;
    Ok(stmt.query_map([], playlist_from_row)?.collect::<Result<_, _>>()?)
}

pub const COLLAGE_COVERS: usize = 4;

/// The list answer: one query for counts, one for covers, no per-playlist reads.
pub fn list_with_covers(conn: &Connection) -> Result<Vec<PlaylistListItem>, StoreError> {
    let playlists = list(conn)?;
    let mut counts: HashMap<String, i64> = HashMap::new();
    let mut stmt = conn.prepare("SELECT playlist_id, COUNT(*) FROM playlist_items GROUP BY playlist_id")?;
    for row in stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))? {
        let (id, count) = row?;
        counts.insert(id, count);
    }
    // the first COLLAGE_COVERS distinct covers per playlist, numbered in the database so no more than that is read back;
    // the partitions walk playlist_items_order (playlist_id, position)
    let mut covers: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "WITH firsts AS (
             SELECT i.playlist_id AS pid, t.cover_url AS url, i.position AS pos, i.added_at AS added, i.id AS item,
                    ROW_NUMBER() OVER (PARTITION BY i.playlist_id, t.cover_url ORDER BY i.position, i.added_at, i.id) AS dup
             FROM playlist_items i JOIN tracks t ON t.id = i.track_id
             WHERE t.cover_url IS NOT NULL AND t.cover_url != ''
         ), ranked AS (
             SELECT pid, url, ROW_NUMBER() OVER (PARTITION BY pid ORDER BY pos, added, item) AS rank FROM firsts WHERE dup = 1
         )
         SELECT pid, url FROM ranked WHERE rank <= ?1 ORDER BY pid, rank",
    )?;
    for row in stmt.query_map([COLLAGE_COVERS as i64], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))? {
        let (id, url) = row?;
        covers.entry(id).or_default().push(url);
    }
    Ok(playlists
        .into_iter()
        .map(|playlist| {
            let track_count = counts.get(&playlist.id).copied().unwrap_or(0);
            let covers = covers.remove(&playlist.id).unwrap_or_default();
            PlaylistListItem { playlist, track_count, covers }
        })
        .collect())
}

fn find(conn: &Connection, id: &str) -> Result<UserPlaylist, StoreError> {
    conn.query_row(&format!("{PLAYLIST_SELECT} WHERE p.id = ?1"), [id], playlist_from_row)
        .optional()?
        .ok_or(StoreError::NotFound("playlist"))
}

pub fn get(conn: &Connection, id: &str) -> Result<PlaylistWithItems, StoreError> {
    let playlist = find(conn, id)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT i.id, i.position, i.added_at, t.snapshot_json,
                EXISTS(SELECT 1 FROM liked_tracks l WHERE l.track_id = i.track_id)
         FROM playlist_items i JOIN tracks t ON t.id = i.track_id
         WHERE i.playlist_id = ?1 ORDER BY {}",
        order_by(&playlist.sort_mode, playlist.sort_desc)
    ))?;
    let rows = stmt
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?, row.get::<_, i64>(2)?, row.get::<_, String>(3)?, row.get::<_, bool>(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let items = rows
        .into_iter()
        .map(|(id, position, added_at, raw, liked)| {
            Ok(UserPlaylistItem { id, track: with_viewer(tracks::parse(&raw)?, liked), position, added_at: iso_from_ms(added_at) })
        })
        .collect::<Result<_, StoreError>>()?;
    Ok(PlaylistWithItems { playlist, items, total: None, next_cursor: None })
}

/// One page of items in the playlist's stored sort, optionally filtered by `q` (title, artist or
/// album, case-insensitive in any script). Keyset paging: the cursor is the id of the last item
/// served, so an insert or removal elsewhere never shifts a page; a removed cursor item is a conflict.
pub fn items_page(conn: &Connection, pid: &str, cursor: Option<&str>, limit: usize, q: Option<&str>) -> Result<PlaylistItemsPage, StoreError> {
    let playlist = find(conn, pid)?;
    let keys = sort_keys(&playlist.sort_mode, playlist.sort_desc);
    let limit = limit.clamp(1, PAGE_MAX);
    let needle = q.map(|q| q.trim().to_lowercase()).filter(|q| !q.is_empty());
    let filter = "(?2 IS NULL OR instr(nuvo_fold(t.title), ?2) > 0 OR instr(nuvo_fold(t.artist), ?2) > 0
                   OR instr(nuvo_fold(coalesce(t.album, '')), ?2) > 0)";
    let total: i64 = conn.query_row(
        &format!("SELECT count(*) FROM playlist_items i JOIN tracks t ON t.id = i.track_id WHERE i.playlist_id = ?1 AND {filter}"),
        params![pid, needle],
        |row| row.get(0),
    )?;
    let mut values: Vec<rusqlite::types::Value> = vec![pid.to_string().into(), needle.into(), (limit as i64 + 1).into()];
    let mut after = String::new();
    if let Some(cursor) = cursor {
        let exprs = keys.iter().map(|(expr, _)| *expr).collect::<Vec<_>>().join(", ");
        let row = conn
            .query_row(
                &format!("SELECT {exprs} FROM playlist_items i JOIN tracks t ON t.id = i.track_id WHERE i.playlist_id = ?1 AND i.id = ?2"),
                params![pid, cursor],
                |row| (0..keys.len()).map(|i| row.get::<_, rusqlite::types::Value>(i)).collect::<rusqlite::Result<Vec<_>>>(),
            )
            .optional()?
            .ok_or(StoreError::Conflict("playlist changed, reload and retry"))?;
        values.extend(row);
        after = format!(" AND ({})", after_cursor(&keys, 4));
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT i.id, i.position, i.added_at, t.snapshot_json, EXISTS(SELECT 1 FROM liked_tracks l WHERE l.track_id = i.track_id)
         FROM playlist_items i JOIN tracks t ON t.id = i.track_id
         WHERE i.playlist_id = ?1 AND {filter}{after} ORDER BY {} LIMIT ?3",
        order_by(&playlist.sort_mode, playlist.sort_desc)
    ))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(values), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?, row.get::<_, i64>(2)?, row.get::<_, String>(3)?, row.get::<_, bool>(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = (rows.len() > limit).then(|| rows[limit - 1].0.clone());
    let items = rows
        .into_iter()
        .take(limit)
        .map(|(id, position, added_at, raw, liked)| {
            Ok(UserPlaylistItem { id, track: with_viewer(tracks::parse(&raw)?, liked), position, added_at: iso_from_ms(added_at) })
        })
        .collect::<Result<_, StoreError>>()?;
    Ok(PlaylistItemsPage { items, total: total as usize, next_cursor })
}

/// The detail with only the first page of items, for `GET /v1/me/playlists/:id?limit=`.
pub fn get_head(conn: &Connection, pid: &str, limit: usize) -> Result<PlaylistWithItems, StoreError> {
    let playlist = find(conn, pid)?;
    let page = items_page(conn, pid, None, limit, None)?;
    Ok(PlaylistWithItems { playlist, items: page.items, total: Some(page.total), next_cursor: page.next_cursor })
}

pub fn create(conn: &Connection, input: &CreatePlaylist, now: i64) -> Result<UserPlaylist, StoreError> {
    let id = new_id();
    conn.execute(
        "INSERT INTO playlists (id, title, description, is_public, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, clean_title(&input.title)?, input.description, input.is_public, now],
    )?;
    find(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: &UpdatePlaylist, now: i64) -> Result<UserPlaylist, StoreError> {
    let current = find(conn, id)?;
    let title = match &input.title {
        Some(title) => clean_title(title)?,
        None => current.title,
    };
    let description = input.description.clone().unwrap_or(current.description);
    let sort_mode = match &input.sort_mode {
        Some(mode) if SORT_MODES.contains(&mode.as_str()) => mode.clone(),
        Some(_) => return Err(StoreError::Invalid(format!("sortMode must be one of: {}", SORT_MODES.join(", ")))),
        None => current.sort_mode,
    };
    conn.execute(
        "UPDATE playlists SET title = ?2, description = ?3, is_public = ?4, pinned_offline = ?5, updated_at = ?6,
                sort_mode = ?7, sort_desc = ?8 WHERE id = ?1",
        params![
            id,
            title,
            description,
            input.is_public.unwrap_or(current.is_public),
            input.pinned_offline.unwrap_or(current.pinned_offline),
            now,
            sort_mode,
            input.sort_desc.unwrap_or(current.sort_desc)
        ],
    )?;
    find(conn, id)
}

/// Also drops the playlist's pin or hide: own playlist ids never come back.
pub fn delete(conn: &Connection, id: &str) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
    tx.execute("DELETE FROM library_flags WHERE kind = 'playlist' AND id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// Replaces the custom cover. `updated_at` moves so list caches keyed by it refresh.
pub fn set_cover(conn: &Connection, pid: &str, mime: &str, bytes: &[u8], now: i64) -> Result<UserPlaylist, StoreError> {
    let tx = conn.unchecked_transaction()?;
    find(&tx, pid)?;
    tx.execute(
        "INSERT INTO playlist_covers (playlist_id, mime, bytes, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(playlist_id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at",
        params![pid, mime, bytes, now],
    )?;
    tx.execute("UPDATE playlists SET updated_at = ?2 WHERE id = ?1", params![pid, now])?;
    let playlist = find(&tx, pid)?;
    tx.commit()?;
    Ok(playlist)
}

/// `(mime, bytes)` of the custom cover, `None` when the playlist has none (or does not exist).
pub fn cover(conn: &Connection, pid: &str) -> Result<Option<(String, Vec<u8>)>, StoreError> {
    Ok(conn
        .query_row("SELECT mime, bytes FROM playlist_covers WHERE playlist_id = ?1", [pid], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?)
}

pub fn delete_cover(conn: &Connection, pid: &str, now: i64) -> Result<UserPlaylist, StoreError> {
    let tx = conn.unchecked_transaction()?;
    find(&tx, pid)?;
    if tx.execute("DELETE FROM playlist_covers WHERE playlist_id = ?1", [pid])? > 0 {
        tx.execute("UPDATE playlists SET updated_at = ?2 WHERE id = ?1", params![pid, now])?;
    }
    let playlist = find(&tx, pid)?;
    tx.commit()?;
    Ok(playlist)
}

fn touch(conn: &Connection, id: &str, now: i64) -> Result<(), StoreError> {
    conn.execute("UPDATE playlists SET revision = revision + 1, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    Ok(())
}

fn contains(conn: &Connection, pid: &str, track_id: &str) -> Result<bool, StoreError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2)",
        params![pid, track_id],
        |row| row.get(0),
    )?)
}

fn insert_item(conn: &Connection, pid: &str, track_id: &str, now: i64) -> Result<String, StoreError> {
    let position: f64 = conn.query_row(
        "SELECT coalesce(max(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1",
        [pid],
        |row| row.get(0),
    )?;
    let item_id = new_id();
    conn.execute(
        "INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![item_id, pid, track_id, position, now],
    )?;
    Ok(item_id)
}

fn item(conn: &Connection, pid: &str, item_id: &str) -> Result<UserPlaylistItem, StoreError> {
    get(conn, pid)?
        .items
        .into_iter()
        .find(|i| i.id == item_id)
        .ok_or(StoreError::NotFound("playlist item"))
}

pub fn add_track(conn: &Connection, pid: &str, track_id: &str, snapshot: Option<Value>, now: i64) -> Result<UserPlaylistItem, StoreError> {
    let tx = conn.unchecked_transaction()?;
    find(&tx, pid)?;
    tracks::ensure(&tx, track_id, snapshot.as_ref(), now)?;
    if contains(&tx, pid, track_id)? {
        return Err(StoreError::Conflict("track is already in this playlist"));
    }
    let item_id = insert_item(&tx, pid, track_id, now)?;
    touch(&tx, pid, now)?;
    let created = item(&tx, pid, &item_id)?;
    tx.commit()?;
    Ok(created)
}

/// Invalid snapshots count as rejected; tracks already present are skipped silently.
pub fn add_tracks(conn: &Connection, pid: &str, snapshots: Vec<Value>, now: i64) -> Result<BulkAddResult, StoreError> {
    if snapshots.len() > MAX_BULK_TRACKS {
        return Err(StoreError::Invalid(format!("at most {MAX_BULK_TRACKS} tracks per request")));
    }
    let tx = conn.unchecked_transaction()?;
    find(&tx, pid)?;
    let mut added_ids = Vec::new();
    let mut rejected = 0;
    for snapshot in &snapshots {
        let Ok(fields) = TrackFields::from_snapshot(snapshot) else {
            rejected += 1;
            continue;
        };
        if contains(&tx, pid, &fields.id)? {
            continue;
        }
        tracks::upsert(&tx, snapshot, now)?;
        added_ids.push(insert_item(&tx, pid, &fields.id, now)?);
    }
    if !added_ids.is_empty() {
        touch(&tx, pid, now)?;
    }
    let all = get(&tx, pid)?.items;
    tx.commit()?;
    let items: Vec<_> = all.into_iter().filter(|i| added_ids.contains(&i.id)).collect();
    Ok(BulkAddResult { added: items.len(), items, rejected })
}

pub fn remove_item(conn: &Connection, pid: &str, item_id: &str, now: i64) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    let removed = tx.execute("DELETE FROM playlist_items WHERE id = ?1 AND playlist_id = ?2", params![item_id, pid])?;
    if removed == 0 {
        return Err(StoreError::NotFound("playlist item"));
    }
    touch(&tx, pid, now)?;
    tx.commit()?;
    Ok(())
}

/// Moves `item_id` in front of `before` (or to the end). `revision` must match the stored one.
pub fn move_item(conn: &Connection, pid: &str, item_id: &str, before: Option<&str>, revision: i64, now: i64) -> Result<PlaylistWithItems, StoreError> {
    let tx = conn.unchecked_transaction()?;
    if find(&tx, pid)?.revision != revision {
        return Err(StoreError::Conflict("playlist changed, reload and retry"));
    }
    if before == Some(item_id) {
        return Err(StoreError::Invalid("an item cannot move before itself".into()));
    }
    let mut others = ordered_items(&tx, pid)?;
    let original_len = others.len();
    others.retain(|(id, _)| id != item_id);
    if others.len() == original_len {
        return Err(StoreError::NotFound("playlist item"));
    }
    let mut position = position_before(&others, before)?;
    if position.is_none() {
        renumber(&tx, &others)?;
        others = ordered_items(&tx, pid)?;
        others.retain(|(id, _)| id != item_id);
        position = position_before(&others, before)?;
    }
    let position = position.expect("renumbered positions leave a gap of 1");
    tx.execute("UPDATE playlist_items SET position = ?2 WHERE id = ?1", params![item_id, position])?;
    touch(&tx, pid, now)?;
    let result = get(&tx, pid)?;
    tx.commit()?;
    Ok(result)
}

pub fn offline_progress(conn: &Connection, pid: &str) -> Result<OfflineProgress, StoreError> {
    find(conn, pid)?;
    let (total, cached) = conn.query_row(
        "SELECT count(*), coalesce(sum(CASE WHEN c.track_id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM local_files f WHERE f.track_id = i.track_id) THEN 1 ELSE 0 END), 0)
         FROM playlist_items i LEFT JOIN cache_entries c ON c.track_id = i.track_id
         WHERE i.playlist_id = ?1",
        [pid],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(OfflineProgress { cached, total })
}

fn check_bulk(len: usize) -> Result<(), StoreError> {
    if len > MAX_BULK_TRACKS {
        return Err(StoreError::Invalid(format!("at most {MAX_BULK_TRACKS} items per request")));
    }
    Ok(())
}

/// `(item_id, track_id)` of the selected items in manual order; ids not in the playlist are dropped.
fn selected_items(conn: &Connection, pid: &str, item_ids: &[String]) -> Result<Vec<(String, String)>, StoreError> {
    let wanted: HashSet<&str> = item_ids.iter().map(String::as_str).collect();
    let mut stmt = conn.prepare("SELECT id, track_id FROM playlist_items WHERE playlist_id = ?1 ORDER BY position, added_at, id")?;
    let rows = stmt
        .query_map([pid], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().filter(|(id, _)| wanted.contains(id.as_str())).collect())
}

/// Removes the given items in one transaction. Ids that are not in the playlist are ignored,
/// so a repeated request is harmless; the revision moves only when something was removed.
pub fn remove_items(conn: &Connection, pid: &str, item_ids: &[String], now: i64) -> Result<RemoveResult, StoreError> {
    check_bulk(item_ids.len())?;
    let tx = conn.unchecked_transaction()?;
    find(&tx, pid)?;
    let mut removed = 0;
    for item_id in item_ids {
        removed += tx.execute("DELETE FROM playlist_items WHERE id = ?1 AND playlist_id = ?2", params![item_id, pid])?;
    }
    if removed > 0 {
        touch(&tx, pid, now)?;
    }
    let revision = find(&tx, pid)?.revision;
    tx.commit()?;
    Ok(RemoveResult { removed, revision })
}

/// Appends the selected items (in manual order) to `target_id`, skipping tracks the target
/// already has, also when the selection itself repeats a track. `Move` then removes every
/// selected item from the source, including the skipped ones: they are in the target already.
pub fn transfer_items(
    conn: &Connection,
    pid: &str,
    item_ids: &[String],
    target_id: &str,
    mode: TransferMode,
    now: i64,
) -> Result<TransferResult, StoreError> {
    check_bulk(item_ids.len())?;
    if pid == target_id {
        return Err(StoreError::Invalid("source and target are the same playlist".into()));
    }
    let tx = conn.unchecked_transaction()?;
    find(&tx, pid)?;
    find(&tx, target_id)?;
    let selected = selected_items(&tx, pid, item_ids)?;
    let mut added_ids = HashSet::new();
    let mut skipped = 0;
    for (_, track_id) in &selected {
        if contains(&tx, target_id, track_id)? {
            skipped += 1;
            continue;
        }
        added_ids.insert(insert_item(&tx, target_id, track_id, now)?);
    }
    let mut removed = 0;
    if mode == TransferMode::Move {
        for (item_id, _) in &selected {
            removed += tx.execute("DELETE FROM playlist_items WHERE id = ?1", [item_id])?;
        }
    }
    if !added_ids.is_empty() {
        touch(&tx, target_id, now)?;
    }
    if removed > 0 {
        touch(&tx, pid, now)?;
    }
    let source_revision = find(&tx, pid)?.revision;
    let target = get(&tx, target_id)?;
    tx.commit()?;
    let added = target.items.into_iter().filter(|i| added_ids.contains(&i.id)).collect();
    Ok(TransferResult { added, skipped, removed, source_revision, target_revision: target.playlist.revision })
}

/// Undo of remove and move: puts items back with their old position and date added.
/// Tracks already in the playlist are skipped; tracks the library does not know count as rejected.
pub fn insert_items(conn: &Connection, pid: &str, items: &[InsertItem], now: i64) -> Result<BulkAddResult, StoreError> {
    check_bulk(items.len())?;
    let tx = conn.unchecked_transaction()?;
    find(&tx, pid)?;
    let mut added_ids = HashSet::new();
    let mut rejected = 0;
    for item in items {
        if !item.position.is_finite() {
            return Err(StoreError::Invalid("position must be a finite number".into()));
        }
        let added_at = ms_from_iso(&item.added_at).ok_or_else(|| StoreError::Invalid("addedAt must be an ISO 8601 UTC timestamp".into()))?;
        if !tracks::snapshot_exists(&tx, &item.track_id)? {
            rejected += 1;
            continue;
        }
        if contains(&tx, pid, &item.track_id)? {
            continue;
        }
        let item_id = new_id();
        tx.execute(
            "INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item_id, pid, item.track_id, item.position, added_at],
        )?;
        added_ids.insert(item_id);
    }
    if !added_ids.is_empty() {
        touch(&tx, pid, now)?;
    }
    let all = get(&tx, pid)?.items;
    tx.commit()?;
    let items: Vec<_> = all.into_iter().filter(|i| added_ids.contains(&i.id)).collect();
    Ok(BulkAddResult { added: items.len(), items, rejected })
}

fn ordered_items(conn: &Connection, pid: &str) -> Result<Vec<(String, f64)>, StoreError> {
    let mut stmt = conn.prepare("SELECT id, position FROM playlist_items WHERE playlist_id = ?1 ORDER BY position, added_at, id")?;
    Ok(stmt.query_map([pid], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?)
}

/// `Ok(None)` means the neighbours are too close and the list needs renumbering first.
fn position_before(items: &[(String, f64)], before: Option<&str>) -> Result<Option<f64>, StoreError> {
    let Some(before) = before else {
        return Ok(Some(items.last().map_or(1.0, |(_, p)| p + 1.0)));
    };
    let index = items
        .iter()
        .position(|(id, _)| id == before)
        .ok_or(StoreError::NotFound("playlist item"))?;
    let next = items[index].1;
    let prev = if index == 0 { next - 1.0 } else { items[index - 1].1 };
    Ok((next - prev >= MIN_GAP).then_some((prev + next) / 2.0))
}

fn renumber(conn: &Connection, items: &[(String, f64)]) -> Result<(), StoreError> {
    for (index, (id, _)) in items.iter().enumerate() {
        conn.execute("UPDATE playlist_items SET position = ?2 WHERE id = ?1", params![id, index as f64 + 1.0])?;
    }
    Ok(())
}

/// `(track_id, position, added_at)` of every item in manual order.
fn manual_items(conn: &Connection, pid: &str) -> Result<Vec<(String, f64, i64)>, StoreError> {
    let mut stmt = conn.prepare("SELECT track_id, position, added_at FROM playlist_items WHERE playlist_id = ?1 ORDER BY position, added_at, id")?;
    Ok(stmt.query_map([pid], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?.collect::<Result<_, _>>()?)
}

fn snapshot(conn: &Connection, pid: &str) -> Result<PlaylistSnapshot, StoreError> {
    let playlist = find(conn, pid)?;
    let items = manual_items(conn, pid)?
        .into_iter()
        .map(|(track_id, position, added_at)| InsertItem { track_id, position, added_at: iso_from_ms(added_at) })
        .collect();
    let cover = cover(conn, pid)?.map(|(mime, bytes)| CoverSnapshot { mime, base64: base64_encode(&bytes) });
    Ok(PlaylistSnapshot {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        is_public: playlist.is_public,
        pinned_offline: playlist.pinned_offline,
        sort_mode: playlist.sort_mode,
        sort_desc: playlist.sort_desc,
        created_at: playlist.created_at,
        revision: playlist.revision,
        items,
        cover,
    })
}

/// Appends every source's items to `target_id`, source by source in manual order. With
/// `skip_duplicates`, a track already in the target or appended before is skipped. With
/// `delete_sources`, the sources go and their snapshots come back for the undo. One transaction:
/// a missing source changes nothing.
pub fn merge(conn: &Connection, target_id: &str, input: &MergePlaylists, now: i64) -> Result<MergeResult, StoreError> {
    let mut sources: Vec<&str> = Vec::new();
    for id in &input.source_ids {
        if !sources.contains(&id.as_str()) {
            sources.push(id);
        }
    }
    if sources.is_empty() {
        return Err(StoreError::Invalid("sourceIds is empty".into()));
    }
    if sources.contains(&target_id) {
        return Err(StoreError::Invalid("a playlist cannot merge into itself".into()));
    }
    let tx = conn.unchecked_transaction()?;
    find(&tx, target_id)?;
    for source in &sources {
        find(&tx, source)?;
    }
    let mut present: HashSet<String> = manual_items(&tx, target_id)?.into_iter().map(|(track_id, _, _)| track_id).collect();
    let mut position: f64 = tx.query_row("SELECT coalesce(max(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1", [target_id], |row| row.get(0))?;
    let (mut added_item_ids, mut skipped) = (Vec::new(), 0);
    for source in &sources {
        for (track_id, _, _) in manual_items(&tx, source)? {
            if input.skip_duplicates && !present.insert(track_id.clone()) {
                skipped += 1;
                continue;
            }
            let item_id = new_id();
            tx.execute(
                "INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![item_id, target_id, track_id, position, now],
            )?;
            added_item_ids.push(item_id);
            position += 1.0;
        }
    }
    if !added_item_ids.is_empty() {
        touch(&tx, target_id, now)?;
    }
    let mut snapshots = Vec::new();
    if input.delete_sources {
        for source in &sources {
            snapshots.push(snapshot(&tx, source)?);
            tx.execute("DELETE FROM playlists WHERE id = ?1", [source])?;
            tx.execute("DELETE FROM library_flags WHERE kind = 'playlist' AND id = ?1", [source])?;
        }
    }
    let revision = find(&tx, target_id)?.revision;
    tx.commit()?;
    let deleted_source_ids = if input.delete_sources { sources.iter().map(|s| s.to_string()).collect() } else { Vec::new() };
    Ok(MergeResult { added: added_item_ids.len(), added_item_ids, skipped, deleted_source_ids, snapshots, revision })
}

/// Undo of a merge that deleted its sources: recreates each playlist with its id, settings,
/// items (positions and dates added) and cover. The revision moves past the stored one so caches
/// keyed by it refresh. A playlist that exists again is a conflict and nothing is restored.
pub fn restore(conn: &Connection, snapshots: &[PlaylistSnapshot], now: i64) -> Result<Vec<UserPlaylist>, StoreError> {
    let tx = conn.unchecked_transaction()?;
    let mut restored = Vec::new();
    for snap in snapshots {
        if snap.id.is_empty() || snap.id.len() > 256 {
            return Err(StoreError::Invalid("bad playlist id".into()));
        }
        if find(&tx, &snap.id).is_ok() {
            return Err(StoreError::Conflict("the playlist exists already"));
        }
        if !SORT_MODES.contains(&snap.sort_mode.as_str()) {
            return Err(StoreError::Invalid("unknown sortMode".into()));
        }
        let created_at = ms_from_iso(&snap.created_at).ok_or_else(|| StoreError::Invalid("createdAt must be an ISO 8601 UTC timestamp".into()))?;
        tx.execute(
            "INSERT INTO playlists (id, title, description, is_public, pinned_offline, revision, created_at, updated_at, sort_mode, sort_desc)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![snap.id, clean_title(&snap.title)?, snap.description, snap.is_public, snap.pinned_offline, snap.revision + 1, created_at, now, snap.sort_mode, snap.sort_desc],
        )?;
        for item in &snap.items {
            let added_at = ms_from_iso(&item.added_at).ok_or_else(|| StoreError::Invalid("addedAt must be an ISO 8601 UTC timestamp".into()))?;
            if !item.position.is_finite() {
                return Err(StoreError::Invalid("position must be a finite number".into()));
            }
            if !tracks::snapshot_exists(&tx, &item.track_id)? {
                return Err(StoreError::NotFound("track"));
            }
            tx.execute(
                "INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id(), snap.id, item.track_id, item.position, added_at],
            )?;
        }
        if let Some(cover) = &snap.cover {
            let bytes = base64_decode(&cover.base64).ok_or_else(|| StoreError::Invalid("cover is not base64".into()))?;
            if !COVER_MIMES.contains(&cover.mime.as_str()) || bytes.is_empty() || bytes.len() > MAX_COVER_BYTES {
                return Err(StoreError::Invalid("cover must be a WebP, JPEG or PNG image up to 400 KB".into()));
            }
            tx.execute("INSERT INTO playlist_covers (playlist_id, mime, bytes, updated_at) VALUES (?1, ?2, ?3, ?4)", params![snap.id, cover.mime, bytes, now])?;
        }
        restored.push(find(&tx, &snap.id)?);
    }
    tx.commit()?;
    Ok(restored)
}
