use nuvo_contracts::{
    CreatePlaylist, ImportCounts, ImportNext, ImportRow, ImportRowsPage, ImportSearch, ImportSummary, TrackFields, iso_from_ms,
};
use nuvo_store::{Connection, StoreError, library, new_id, playlists, tracks};
use std::cell::RefCell;

use nuvo_match::LikedIndex;
use nuvo_match::relevance::Song;
use rusqlite::{OptionalExtension, Row, params};
use serde_json::Value;

use crate::cascade::{self, Cascade};
use crate::{MAX_ROWS, Parsed, SourceRow};

/// A crashed worker loses its row for this long, then another worker gets it.
pub const LEASE_MS: i64 = 60_000;
pub const MAX_CANDIDATES: usize = 100;
pub const ROW_SOURCES: [&str; 8] = ["youtube-music", "soundcloud", "apple-music", "deezer", "spotify", "yandex-music", "nuvo-link", "legacy"];
const LEGACY_REASONS: [&str; 5] = ["low_confidence_match", "ambiguous_match", "duration_mismatch", "no_catalog_candidates", "catalog_lookup_failed"];
const ROWS_PAGE_MAX: usize = 500;

#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    New,
    Playlist(String),
    Liked,
}

struct Meta {
    target_id: Option<String>,
    base_position: f64,
    created_at: i64,
    liked: RefCell<Option<LikedIndex>>,
}

fn meta(conn: &Connection, id: &str) -> Result<Meta, StoreError> {
    conn.query_row("SELECT target_id, base_position, created_at FROM imports WHERE id = ?1", [id], |row| {
        Ok(Meta { target_id: row.get(0)?, base_position: row.get(1)?, created_at: row.get(2)?, liked: RefCell::new(None) })
    })
    .optional()?
    .ok_or(StoreError::NotFound("import"))
}

fn playlist_exists(conn: &Connection, id: &str) -> Result<bool, StoreError> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM playlists WHERE id = ?1)", [id], |row| row.get(0))?)
}

fn require_target(conn: &Connection, meta: &Meta) -> Result<(), StoreError> {
    match &meta.target_id {
        Some(id) if !playlist_exists(conn, id)? => Err(StoreError::NotFound("playlist")),
        _ => Ok(()),
    }
}

fn touch_target(conn: &Connection, meta: &Meta, now: i64) -> Result<(), StoreError> {
    if let Some(id) = &meta.target_id {
        conn.execute("UPDATE playlists SET revision = revision + 1, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }
    Ok(())
}

fn add_to_target(conn: &Connection, meta: &Meta, position: i64, track: &Value, now: i64) -> Result<Option<String>, StoreError> {
    let fields = TrackFields::from_snapshot(track)?;
    match &meta.target_id {
        Some(pid) => {
            let present: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2)",
                params![pid, fields.id],
                |row| row.get(0),
            )?;
            if present {
                return Ok(None);
            }
            tracks::upsert(conn, track, now)?;
            let item_id = new_id();
            conn.execute(
                "INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![item_id, pid, fields.id, meta.base_position + position as f64, now],
            )?;
            Ok(Some(item_id))
        }
        None => {
            if library::is_liked(conn, &fields.id)? {
                return Ok(None);
            }
            // the single and its album copy are one song: the one already liked stands
            let mut cache = meta.liked.borrow_mut();
            if cache.is_none() {
                *cache = Some(LikedIndex::load(conn)?);
            }
            let index = cache.as_mut().expect("loaded above");
            if index.has_twin(&fields.id, track) {
                return Ok(None);
            }
            index.add(fields.id.clone(), track.clone());
            drop(cache);
            tracks::upsert(conn, track, now)?;
            // Liked songs list newest first: the first row of the source stays on top.
            conn.execute("INSERT INTO liked_tracks (track_id, liked_at) VALUES (?1, ?2)", params![fields.id, meta.created_at - position])?;
            Ok(Some(fields.id))
        }
    }
}

fn remove_from_target(conn: &Connection, meta: &Meta, item_ref: &str) -> Result<(), StoreError> {
    match &meta.target_id {
        Some(pid) => {
            conn.execute("DELETE FROM playlist_items WHERE id = ?1 AND playlist_id = ?2", params![item_ref, pid])?;
        }
        None => {
            conn.execute("DELETE FROM liked_tracks WHERE track_id = ?1", [item_ref])?;
        }
    }
    Ok(())
}

pub type LegacyReview = (Option<String>, Option<Value>);

fn legacy_parts(value: &Value) -> Result<LegacyReview, StoreError> {
    let reason = value.get("reason").and_then(Value::as_str).map(String::from);
    if reason.as_deref().is_some_and(|r| !LEGACY_REASONS.contains(&r)) {
        return Err(StoreError::Invalid("unknown review reason".into()));
    }
    Ok((reason, value.get("proposal").filter(|p| p.is_object()).cloned()))
}

pub fn parse_rows(source: &str, label: &str, rows: &[Value]) -> Result<(Parsed, Vec<LegacyReview>), StoreError> {
    let source_kind = ROW_SOURCES.iter().find(|s| **s == source).ok_or_else(|| StoreError::Invalid(format!("source must be one of: {}", ROW_SOURCES.join(", "))))?;
    if rows.len() > MAX_ROWS {
        return Err(StoreError::Invalid("an import has at most 20,000 rows".into()));
    }
    let label = label.trim();
    if label.is_empty() {
        return Err(StoreError::Invalid("label is required".into()));
    }
    let mut parsed = Vec::with_capacity(rows.len());
    let mut legacy = Vec::with_capacity(rows.len());
    for value in rows {
        let row: SourceRow = serde_json::from_value(value.clone()).map_err(|e| StoreError::Invalid(format!("bad row: {e}")))?;
        parsed.push(row);
        legacy.push(if *source_kind == "legacy" { legacy_parts(value)? } else { (None, None) });
    }
    Ok((Parsed { source_kind, label: label.to_string(), liked: false, rows: parsed }, legacy))
}

pub fn start(conn: &Connection, parsed: &Parsed, legacy: &[LegacyReview], target: Option<Target>, now: i64) -> Result<ImportSummary, StoreError> {
    let target = target.unwrap_or(if parsed.liked { Target::Liked } else { Target::New });
    let tx = conn.unchecked_transaction()?;
    let (target_kind, target_id) = match target {
        Target::Liked => ("liked", None),
        Target::Playlist(id) if playlist_exists(&tx, &id)? => ("playlist", Some(id)),
        Target::Playlist(_) => return Err(StoreError::NotFound("playlist")),
        Target::New => {
            let title: String = parsed.label.chars().take(200).collect();
            let created = playlists::create(&tx, &CreatePlaylist { title, description: None, is_public: false }, now)?;
            ("playlist", Some(created.id))
        }
    };
    let base_position: f64 = match &target_id {
        Some(pid) => tx.query_row("SELECT coalesce(max(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1", [pid], |row| row.get(0))?,
        None => 0.0,
    };
    let id = new_id();
    tx.execute(
        "INSERT INTO imports (id, source_kind, label, target_kind, target_id, base_position, created_at, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running')",
        params![id, parsed.source_kind, parsed.label, target_kind, target_id, base_position, now],
    )?;
    insert_rows(&tx, &id, 0, parsed, legacy, now)?;
    finish_if_done(&tx, &id)?;
    let result = summary(&tx, &id)?;
    tx.commit()?;
    Ok(result)
}

fn insert_rows(tx: &Connection, id: &str, first: i64, parsed: &Parsed, legacy: &[LegacyReview], now: i64) -> Result<(), StoreError> {
    let meta = meta(tx, id)?;
    let mut added_any = false;
    for (offset, row) in parsed.rows.iter().enumerate() {
        let position = first + offset as i64;
        let source_json = serde_json::to_string(row)?;
        let (reason, proposal) = legacy.get(offset).cloned().unwrap_or_default();
        if let Some(track) = &row.track {
            let item_ref = add_to_target(tx, &meta, position, track, now)?;
            added_any |= item_ref.is_some();
            let (label, reason) = if item_ref.is_some() { ("exact", "exact") } else { ("already", "already_there") };
            tx.execute(
                "INSERT INTO import_rows (import_id, position, source_json, label, reason, chosen_track_json, item_ref) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, position, source_json, label, reason, track.to_string(), item_ref],
            )?;
        } else if let Some(reason) = reason {
            tx.execute(
                "INSERT INTO import_rows (import_id, position, source_json, label, reason, chosen_track_json) VALUES (?1, ?2, ?3, 'missing', ?4, ?5)",
                params![id, position, source_json, reason, proposal.map(|p| p.to_string())],
            )?;
        } else {
            tx.execute("INSERT INTO import_rows (import_id, position, source_json) VALUES (?1, ?2, ?3)", params![id, position, source_json])?;
        }
    }
    if added_any {
        touch_target(tx, &meta, now)?;
    }
    Ok(())
}

pub fn append(conn: &Connection, id: &str, rows: &[SourceRow], legacy: &[LegacyReview], now: i64) -> Result<ImportSummary, StoreError> {
    let tx = conn.unchecked_transaction()?;
    let meta = meta(&tx, id)?;
    require_target(&tx, &meta)?;
    let next: i64 = tx.query_row("SELECT coalesce(max(position) + 1, 0) FROM import_rows WHERE import_id = ?1", [id], |row| row.get(0))?;
    if next as usize + rows.len() > MAX_ROWS {
        return Err(StoreError::Invalid("an import has at most 20,000 rows".into()));
    }
    let parsed = Parsed { source_kind: "legacy", label: String::new(), liked: false, rows: rows.to_vec() };
    insert_rows(&tx, id, next, &parsed, legacy, now)?;
    finish_if_done(&tx, id)?;
    let result = summary(&tx, id)?;
    tx.commit()?;
    Ok(result)
}

fn finish_if_done(conn: &Connection, id: &str) -> Result<bool, StoreError> {
    let pending: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM import_rows WHERE import_id = ?1 AND label IS NULL)", [id], |row| row.get(0))?;
    conn.execute("UPDATE imports SET status = ?2 WHERE id = ?1", params![id, if pending { "running" } else { "done" }])?;
    Ok(!pending)
}

fn summaries(conn: &Connection, only: Option<&str>) -> Result<Vec<ImportSummary>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.source_kind, i.label, i.target_kind, i.target_id, i.created_at, i.status, r.label, count(r.id),
                coalesce(sum(r.label IN ('check', 'missing') AND r.decision IS NULL), 0)
         FROM imports i LEFT JOIN import_rows r ON r.import_id = i.id
         WHERE ?1 IS NULL OR i.id = ?1
         GROUP BY i.id, r.label ORDER BY i.created_at DESC, i.id",
    )?;
    let mut out: Vec<ImportSummary> = Vec::new();
    let rows = stmt.query_map([only], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, i64>(8)?,
            row.get::<_, i64>(9)?,
        ))
    })?;
    for row in rows {
        let (id, source_kind, label, target_kind, target_id, created_at, status, row_label, count, review) = row?;
        if out.last().is_none_or(|last| last.id != id) {
            out.push(ImportSummary {
                id,
                source_kind,
                label,
                target_kind,
                target_id,
                created_at: iso_from_ms(created_at),
                status,
                total: 0,
                done: 0,
                needs_review: 0,
                counts: ImportCounts::default(),
            });
        }
        let Some(summary) = out.last_mut() else { continue };
        summary.total += count;
        summary.needs_review += review;
        if let Some(name) = row_label.as_deref() {
            summary.done += count;
            match name {
                "exact" => summary.counts.exact = count,
                "likely" => summary.counts.likely = count,
                "check" => summary.counts.check = count,
                "missing" => summary.counts.missing = count,
                "already" => summary.counts.already = count,
                _ => {}
            }
        }
    }
    Ok(out)
}

pub fn summary(conn: &Connection, id: &str) -> Result<ImportSummary, StoreError> {
    summaries(conn, Some(id))?.pop().ok_or(StoreError::NotFound("import"))
}

pub fn list(conn: &Connection) -> Result<Vec<ImportSummary>, StoreError> {
    summaries(conn, None)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM imports WHERE id = ?1", [id])?;
    Ok(())
}

struct Pending {
    id: i64,
    source: SourceRow,
    cascade: Cascade,
}

fn pending_from_row(row: &Row) -> rusqlite::Result<(i64, String, String)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
}

fn to_pending((id, source, cascade): (i64, String, String)) -> Result<Pending, StoreError> {
    Ok(Pending { id, source: serde_json::from_str(&source)?, cascade: serde_json::from_str(&cascade)? })
}

fn finalize(conn: &Connection, meta: &Meta, row: &Pending, position: i64, now: i64) -> Result<(), StoreError> {
    let outcome = cascade::outcome(&row.source, &row.cascade);
    let mut label = outcome.label;
    let mut item_ref = None;
    if let (Some(track), "likely" | "check") = (&outcome.track, label) {
        item_ref = add_to_target(conn, meta, position, track, now)?;
        if item_ref.is_none() {
            label = "already";
        } else {
            touch_target(conn, meta, now)?;
        }
    }
    conn.execute(
        "UPDATE import_rows SET label = ?2, score = ?3, reason = ?4, chosen_track_json = ?5, candidates_json = ?6, cascade_json = ?7,
                item_ref = ?8, lease_until = 0 WHERE id = ?1",
        params![
            row.id,
            label,
            outcome.score,
            if label == "already" { "already_there" } else { outcome.reason },
            outcome.track.map(|t| t.to_string()),
            Value::Array(outcome.candidates).to_string(),
            serde_json::to_string(&row.cascade)?,
            item_ref
        ],
    )?;
    Ok(())
}

pub fn next(conn: &Connection, id: &str, now: i64) -> Result<ImportNext, StoreError> {
    let tx = conn.unchecked_transaction()?;
    let meta = meta(&tx, id)?;
    require_target(&tx, &meta)?;
    let free = tx
        .query_row(
            "SELECT id, source_json, cascade_json FROM import_rows WHERE import_id = ?1 AND label IS NULL AND lease_until <= ?2 ORDER BY position LIMIT 1",
            params![id, now],
            pending_from_row,
        )
        .optional()?;
    let answer = match free.map(to_pending).transpose()? {
        Some(row) => {
            let searches = cascade::next_searches(&row.source, &row.cascade);
            if searches.is_empty() {
                let position: i64 = tx.query_row("SELECT position FROM import_rows WHERE id = ?1", [row.id], |r| r.get(0))?;
                finalize(&tx, &meta, &row, position, now)?;
                ImportNext::Wait { wait: 100 }
            } else {
                tx.execute("UPDATE import_rows SET lease_until = ?2 WHERE id = ?1", params![row.id, now + LEASE_MS])?;
                let searches = searches.into_iter().map(|(step, s)| ImportSearch { query: s.query, filter: s.filter.into(), source: s.source.into(), step }).collect();
                ImportNext::Search { row_id: row.id, searches }
            }
        }
        None => {
            let earliest: Option<i64> = tx.query_row("SELECT min(lease_until) FROM import_rows WHERE import_id = ?1 AND label IS NULL", [id], |row| row.get(0))?;
            match earliest {
                Some(until) => ImportNext::Wait { wait: (until - now).clamp(100, LEASE_MS) as u64 },
                None => {
                    finish_if_done(&tx, id)?;
                    ImportNext::Done { done: true }
                }
            }
        }
    };
    tx.commit()?;
    Ok(answer)
}

// `step` must be an open search of the row, so a late answer from an expired lease cannot count twice
pub fn post_candidates(conn: &Connection, id: &str, row_id: i64, step: usize, candidates: Vec<Value>, failed: bool, now: i64) -> Result<ImportRow, StoreError> {
    if candidates.len() > MAX_CANDIDATES {
        return Err(StoreError::Invalid(format!("at most {MAX_CANDIDATES} candidates per search")));
    }
    if candidates.iter().any(|c| TrackFields::from_snapshot(c).is_err()) {
        return Err(StoreError::Invalid("every candidate needs a track id".into()));
    }
    let tx = conn.unchecked_transaction()?;
    let meta = meta(&tx, id)?;
    require_target(&tx, &meta)?;
    let (raw, label, position) = tx
        .query_row(
            "SELECT id, source_json, cascade_json, label, position FROM import_rows WHERE id = ?1 AND import_id = ?2",
            params![row_id, id],
            |row| Ok((pending_from_row(row)?, row.get::<_, Option<String>>(3)?, row.get::<_, i64>(4)?)),
        )
        .optional()?
        .ok_or(StoreError::NotFound("import row"))?;
    if label.is_some() {
        return Err(StoreError::Conflict("this row is decided already"));
    }
    let mut row = to_pending(raw)?;
    let open = cascade::next_searches(&row.source, &row.cascade);
    let round = open.iter().find(|(i, _)| *i == step).map(|(_, s)| s.round).ok_or(StoreError::Conflict("this search step was answered already"))?;
    cascade::record(&row.source, &mut row.cascade, step, candidates, failed);
    if cascade::is_finished(&row.source, &row.cascade) {
        finalize(&tx, &meta, &row, position, now)?;
        finish_if_done(&tx, id)?;
    } else {
        // The worker still holds the round's other searches; the next round is free for anyone
        let round_open = cascade::next_searches(&row.source, &row.cascade).iter().any(|(_, s)| s.round == round);
        tx.execute(
            "UPDATE import_rows SET cascade_json = ?2, lease_until = CASE WHEN ?3 THEN lease_until ELSE 0 END WHERE id = ?1",
            params![row.id, serde_json::to_string(&row.cascade)?, round_open],
        )?;
    }
    let result = report_row(&tx, id, row_id)?;
    tx.commit()?;
    Ok(result)
}

const CSV_PAGE: usize = 500;
const CSV_SELECT: &str = "SELECT id, position, source_json, label, score, reason, chosen_track_json, '[]', decision FROM import_rows";
const ROW_SELECT: &str = "SELECT id, position, source_json, label, score, reason, chosen_track_json, candidates_json, decision FROM import_rows";

type RawRow = (i64, i64, String, Option<String>, Option<i64>, Option<String>, Option<String>, String, Option<String>);

fn row_from_sql(row: &Row) -> rusqlite::Result<RawRow> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?))
}

fn to_report_row((id, position, source, label, score, reason, track, candidates, decision): RawRow) -> Result<ImportRow, StoreError> {
    let source: Value = serde_json::from_str(&source)?;
    let track: Option<Value> = track.as_deref().map(serde_json::from_str).transpose()?;
    let source_ms = source["durationMs"].as_i64().filter(|ms| *ms > 0);
    let track_ms = track.as_ref().and_then(|t| t["durationMs"].as_f64()).map(|ms| ms.round() as i64).filter(|ms| *ms > 0);
    Ok(ImportRow {
        id,
        position,
        source,
        label,
        score,
        reason,
        track,
        candidates: serde_json::from_str(&candidates)?,
        decision,
        duration_diff_ms: source_ms.zip(track_ms).map(|(a, b)| (a - b).abs()),
    })
}

fn report_row(conn: &Connection, id: &str, row_id: i64) -> Result<ImportRow, StoreError> {
    let raw = conn
        .query_row(&format!("{ROW_SELECT} WHERE id = ?1 AND import_id = ?2"), params![row_id, id], row_from_sql)
        .optional()?
        .ok_or(StoreError::NotFound("import row"))?;
    to_report_row(raw)
}

pub fn rows(conn: &Connection, id: &str, filter: &str, cursor: Option<&str>, limit: usize) -> Result<ImportRowsPage, StoreError> {
    meta(conn, id)?;
    let condition = match filter {
        "review" => "label IN ('check', 'missing') AND decision IS NULL",
        "matched" => "label IN ('exact', 'likely', 'check', 'already')",
        "all" => "1",
        "exact" => "label = 'exact'",
        "likely" => "label = 'likely'",
        "check" => "label = 'check'",
        "missing" => "label = 'missing'",
        "already" => "label = 'already'",
        _ => return Err(StoreError::Invalid("label must be review, matched, all, exact, likely, check, missing or already".into())),
    };
    let after: i64 = match cursor {
        Some(c) => c.parse().map_err(|_| StoreError::Invalid("bad cursor".into()))?,
        None => -1,
    };
    let limit = limit.clamp(1, ROWS_PAGE_MAX);
    let mut stmt = conn.prepare(&format!("{ROW_SELECT} WHERE import_id = ?1 AND position > ?2 AND {condition} ORDER BY position LIMIT ?3"))?;
    let raw = stmt.query_map(params![id, after, limit as i64 + 1], row_from_sql)?.collect::<Result<Vec<_>, _>>()?;
    let mut items = raw.into_iter().map(to_report_row).collect::<Result<Vec<_>, _>>()?;
    let next_cursor = (items.len() > limit).then(|| items[limit - 1].position.to_string());
    items.truncate(limit);
    Ok(ImportRowsPage { items, next_cursor })
}

pub fn decide(conn: &Connection, id: &str, row_id: i64, decision: &str, track: Option<&Value>, now: i64) -> Result<ImportRow, StoreError> {
    let tx = conn.unchecked_transaction()?;
    let meta = meta(&tx, id)?;
    require_target(&tx, &meta)?;
    let (label, position, chosen, item_ref): (Option<String>, i64, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT label, position, chosen_track_json, item_ref FROM import_rows WHERE id = ?1 AND import_id = ?2",
            params![row_id, id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or(StoreError::NotFound("import row"))?;
    let label = label.ok_or(StoreError::Conflict("this row is still being matched"))?;
    let (new_chosen, new_ref) = match decision {
        "use" => {
            let proposal = chosen.as_deref().filter(|_| label == "missing" && item_ref.is_none()).ok_or_else(|| StoreError::Invalid("only a Missing row with a proposal can use it".into()))?;
            let proposal: Value = serde_json::from_str(proposal)?;
            let added = add_to_target(&tx, &meta, position, &proposal, now)?;
            (Some(proposal), added)
        }
        "pick" => {
            let track = track.ok_or_else(|| StoreError::Invalid("pick needs a track".into()))?;
            TrackFields::from_snapshot(track)?;
            if let Some(old) = &item_ref {
                remove_from_target(&tx, &meta, old)?;
            }
            let added = add_to_target(&tx, &meta, position, track, now)?;
            (Some(track.clone()), added)
        }
        "remove" => {
            if let Some(old) = &item_ref {
                remove_from_target(&tx, &meta, old)?;
            }
            (chosen.as_deref().map(serde_json::from_str).transpose()?, None)
        }
        "keep" => (chosen.as_deref().map(serde_json::from_str).transpose()?, item_ref.clone()),
        _ => return Err(StoreError::Invalid("decision must be use, pick, remove or keep".into())),
    };
    if new_ref != item_ref {
        touch_target(&tx, &meta, now)?;
    }
    tx.execute(
        "UPDATE import_rows SET decision = ?2, chosen_track_json = ?3, item_ref = ?4 WHERE id = ?1",
        params![row_id, decision, new_chosen.map(|t| t.to_string()), new_ref],
    )?;
    let result = report_row(&tx, id, row_id)?;
    tx.commit()?;
    Ok(result)
}

pub fn bulk(conn: &Connection, id: &str, action: &str) -> Result<ImportSummary, StoreError> {
    let tx = conn.unchecked_transaction()?;
    meta(&tx, id)?;
    match action {
        "accept-check" => {
            tx.execute("UPDATE import_rows SET decision = 'keep' WHERE import_id = ?1 AND label = 'check' AND decision IS NULL", [id])?;
        }
        "retry-failed" => {
            tx.execute(
                "UPDATE import_rows SET label = NULL, score = NULL, reason = NULL, chosen_track_json = NULL, candidates_json = '[]',
                        cascade_json = '{\"steps\":[],\"pool\":[]}', lease_until = 0
                 WHERE import_id = ?1 AND reason = 'catalog_lookup_failed' AND decision IS NULL",
                [id],
            )?;
            finish_if_done(&tx, id)?;
        }
        _ => return Err(StoreError::Invalid("action must be accept-check or retry-failed".into())),
    }
    let result = summary(&tx, id)?;
    tx.commit()?;
    Ok(result)
}

// A leading =, +, -, @, tab or CR gets a ' so a spreadsheet never runs it as a formula
fn csv_cell(text: &str) -> String {
    let text = if text.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{text}") } else { text.to_string() };
    if text.contains([',', '"', '\n', '\r']) { format!("\"{}\"", text.replace('"', "\"\"")) } else { text }
}

fn names(track: &Value) -> String {
    track["artists"].as_array().into_iter().flatten().filter_map(|a| a["name"].as_str()).collect::<Vec<_>>().join("; ")
}

pub fn report_csv(conn: &Connection, id: &str) -> Result<String, StoreError> {
    meta(conn, id)?;
    let mut out = String::from("position,source_title,source_artists,source_album,source_duration_ms,label,score,reason,decision,match_id,match_title,match_artists,match_duration_ms,match_source\n");
    let mut after = -1;
    loop {
        // Pages by position and skips the candidate lists, so a 20,000 row report stays small in memory.
        let mut stmt = conn.prepare(&format!("{CSV_SELECT} WHERE import_id = ?1 AND position > ?2 ORDER BY position LIMIT {CSV_PAGE}"))?;
        let raw = stmt.query_map(params![id, after], row_from_sql)?.collect::<Result<Vec<_>, _>>()?;
        let Some(last) = raw.last() else { break };
        after = last.1;
        let full = raw.len() == CSV_PAGE;
    for row in raw.into_iter().map(to_report_row) {
        let row = row?;
        let source: SourceRow = serde_json::from_value(row.source.clone())?;
        let track = row.track.clone().unwrap_or(Value::Null);
        let number = |v: Option<i64>| v.map(|n| n.to_string()).unwrap_or_default();
        let cells = [
            row.position.to_string(),
            csv_cell(&source.title),
            csv_cell(&source.artists.join("; ")),
            csv_cell(source.album.as_deref().unwrap_or("")),
            number(source.duration_ms),
            row.label.unwrap_or_default(),
            number(row.score),
            row.reason.unwrap_or_default(),
            row.decision.unwrap_or_default(),
            csv_cell(track["id"].as_str().unwrap_or("")),
            csv_cell(track["title"].as_str().unwrap_or("")),
            csv_cell(&names(&track)),
            number(track["durationMs"].as_f64().map(|ms| ms.round() as i64)),
            Song::from_track(&track).map(|s| s.origin().as_str()).unwrap_or_default().to_string(),
        ];
        out.push_str(&cells.join(","));
        out.push('\n');
    }
        if !full {
            break;
        }
    }
    Ok(out)
}
