use rusqlite::{Connection, params};
use serde_json::Value;

use crate::StoreError;

/// Older recognitions beyond this many are deleted on insert.
pub const KEEP: i64 = 500;

#[derive(Debug, Clone, PartialEq)]
pub struct Recognition {
    pub id: String,
    pub created_at: i64,
    /// The `RecognizedTrack` JSON as the renderer receives it.
    pub result: Value,
}

pub fn insert(conn: &Connection, id: &str, created_at: i64, input_kind: &str, input_label: &str, result: &Value) -> Result<(), StoreError> {
    let label = if input_label.len() > 512 {
        &input_label[..input_label.floor_char_boundary(512)]
    } else {
        input_label
    };
    conn.execute_batch("SAVEPOINT recog")?;
    let result_str = serde_json::to_string(result)?;
    match (
        conn.execute(
            "INSERT INTO recognitions (id, created_at, input_kind, input_label, result_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, created_at, input_kind, label, &result_str],
        ),
        conn.execute(
            "DELETE FROM recognitions WHERE id NOT IN (SELECT id FROM recognitions ORDER BY created_at DESC, rowid DESC LIMIT ?1)",
            [KEEP],
        ),
    ) {
        (Ok(_), Ok(_)) => {
            conn.execute_batch("RELEASE recog")?;
            Ok(())
        }
        _ => {
            let _ = conn.execute_batch("ROLLBACK TO recog");
            Err(StoreError::Invalid("failed to insert and trim recognitions".into()))
        }
    }
}

/// Newest first.
pub fn list(conn: &Connection, limit: i64) -> Result<Vec<Recognition>, StoreError> {
    let clamped_limit = limit.clamp(1, 500);
    let mut statement = conn.prepare("SELECT id, created_at, result_json FROM recognitions ORDER BY created_at DESC, rowid DESC LIMIT ?1")?;
    let rows = statement.query_map([clamped_limit], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?)))?;
    rows.map(|row| {
        let (id, created_at, json) = row?;
        Ok(Recognition { id, created_at, result: serde_json::from_str(&json)? })
    })
    .collect()
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), StoreError> {
    match conn.execute("DELETE FROM recognitions WHERE id = ?1", [id])? {
        0 => Err(StoreError::NotFound("recognition")),
        _ => Ok(()),
    }
}
