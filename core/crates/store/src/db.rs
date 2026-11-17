use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};

use nuvo_crypto::{MasterKey, derive_key, to_hex};
use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, ErrorCode, params};

use crate::{StoreError, now_ms, schema::MIGRATIONS};

pub const DB_KEY_INFO: &str = "nuvo/db/v1";
const KEEP_BACKUPS: usize = 3;

pub fn open_connection(path: &Path, db_key: &[u8; 32], backups_dir: &Path) -> Result<Connection, StoreError> {
    connect(path, Some(db_key), backups_dir)
}

pub fn open_library(path: &Path, master: Option<&MasterKey>, backups_dir: &Path) -> Result<Connection, StoreError> {
    connect(path, master.map(db_key).as_ref(), backups_dir)
}

fn db_key(master: &MasterKey) -> [u8; 32] {
    derive_key(master, DB_KEY_INFO)
}

// Raw-key syntax skips PBKDF2; an empty key means no encryption
fn key_literal(db_key: Option<&[u8; 32]>) -> String {
    db_key.map(|key| format!("x'{}'", to_hex(key))).unwrap_or_default()
}

pub fn is_plain_database(path: &Path) -> bool {
    let mut header = [0u8; 16];
    fs::File::open(path).and_then(|mut file| file.read_exact(&mut header)).is_ok() && &header == b"SQLite format 3\0"
}

/// Rewrites library.db from one master key to another, or to or from none; the old file goes to the backups first.
pub fn convert_database(path: &Path, from: Option<&MasterKey>, to: Option<&MasterKey>, backups_dir: &Path) -> Result<(), StoreError> {
    let conn = open_library(path, from, backups_dir)?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    backup_database(&conn, path, backups_dir, usize::try_from(version).unwrap_or_default())?;
    let next = path.with_extension("next");
    remove_if_exists(&next)?;
    let exported = (|| -> Result<(), StoreError> {
        conn.execute("ATTACH DATABASE ?1 AS next KEY ?2", params![next.to_string_lossy(), key_literal(to.map(db_key).as_ref())])?;
        conn.query_row("SELECT sqlcipher_export('next')", [], |_| Ok(()))?;
        conn.pragma_update(Some("next"), "user_version", version)?;
        conn.execute_batch("DETACH DATABASE next;")?;
        Ok(())
    })();
    drop(conn);
    if let Err(err) = exported {
        remove_if_exists(&next)?;
        return Err(err);
    }
    for suffix in ["-wal", "-shm"] {
        let mut side = path.as_os_str().to_owned();
        side.push(suffix);
        remove_if_exists(Path::new(&side))?;
    }
    fs::rename(&next, path)?;
    Ok(())
}

fn remove_if_exists(path: &Path) -> Result<(), StoreError> {
    match fs::remove_file(path) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

fn connect(path: &Path, db_key: Option<&[u8; 32]>, backups_dir: &Path) -> Result<Connection, StoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let existed = path.exists();
    let mut conn = Connection::open(path)?;
    // pragma_update quoting would turn the raw key into a passphrase
    if db_key.is_some() {
        conn.execute_batch(&format!("PRAGMA key = \"{}\";", key_literal(db_key)))?;
    }
    if let Err(err) = conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0)) {
        return Err(match err.sqlite_error_code() {
            Some(ErrorCode::NotADatabase) => StoreError::WrongKey,
            _ => err.into(),
        });
    }
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;")?;
    // `nuvo_fold(text)`: lowercase in every script, so a filter for "кино" finds "Кино".
    conn.create_scalar_function("nuvo_fold", 1, FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC, |ctx| {
        Ok(ctx.get::<Option<String>>(0)?.map(|text| text.to_lowercase()))
    })?;
    migrate(&mut conn, path, backups_dir, existed)?;
    add_served_learned(&conn)?;
    add_local_keys(&conn)?;
    add_folder_art(&conn)?;
    // Off while migrating: migration 19 rebuilds tracks and the pragma cannot change in a transaction
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

// Some builds applied migration 8 before it gained served.learned, so the column may be missing
fn add_served_learned(conn: &Connection) -> Result<(), StoreError> {
    let (has_served, has_learned): (bool, bool) = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'served'),
                EXISTS(SELECT 1 FROM pragma_table_info('served') WHERE name = 'learned')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if has_served && !has_learned {
        conn.execute_batch("ALTER TABLE served ADD COLUMN learned INTEGER NOT NULL DEFAULT 0")?;
    }
    Ok(())
}

fn add_local_keys(conn: &Connection) -> Result<(), StoreError> {
    let has: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('local_files') WHERE name = 'sort_key')", [], |row| row.get(0))?;
    if has {
        return Ok(());
    }
    conn.execute_batch(
        "ALTER TABLE local_files ADD COLUMN sort_key TEXT NOT NULL DEFAULT '';
         ALTER TABLE local_files ADD COLUMN search_key TEXT NOT NULL DEFAULT '';
         UPDATE local_files SET
           search_key = (SELECT nuvo_fold(t.title) || char(31) || nuvo_fold(t.artist) || char(31) || nuvo_fold(coalesce(t.album, '')) FROM tracks t WHERE t.id = local_files.track_id),
           sort_key = (SELECT nuvo_fold(t.artist) || char(31) || nuvo_fold(coalesce(t.album, '')) || char(31)
               || printf('%06d', coalesce(json_extract(t.snapshot_json, '$.local.discNo'), 0)) || char(31)
               || printf('%06d', coalesce(json_extract(t.snapshot_json, '$.local.trackNo'), 0)) || char(31) || nuvo_fold(t.title)
             FROM tracks t WHERE t.id = local_files.track_id);
         CREATE INDEX IF NOT EXISTS local_files_sort ON local_files(sort_key, path);",
    )?;
    Ok(())
}

fn add_folder_art(conn: &Connection) -> Result<(), StoreError> {
    let has: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('local_files') WHERE name = 'folder_art')", [], |row| row.get(0))?;
    if !has {
        conn.execute_batch("ALTER TABLE local_files ADD COLUMN folder_art INTEGER")?;
    }
    Ok(())
}

fn migrate(conn: &mut Connection, path: &Path, backups_dir: &Path, existed: bool) -> Result<(), StoreError> {
    // rusqlite 0.41 has no usize conversions.
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let version = usize::try_from(version).map_err(|_| StoreError::Invalid("negative schema version".into()))?;
    if version > MIGRATIONS.len() {
        return Err(StoreError::TooNew(version));
    }
    if version == MIGRATIONS.len() {
        return Ok(());
    }
    if existed && version > 0 {
        backup_database(conn, path, backups_dir, version)?;
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", index as i64 + 1)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn backup_database(conn: &Connection, path: &Path, backups_dir: &Path, version: usize) -> Result<(), StoreError> {
    // Fold the WAL into the main file so the copy is complete.
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    fs::create_dir_all(backups_dir)?;
    // Millisecond prefix keeps lexicographic order chronological.
    let backup = backups_dir.join(format!("library-{}-v{version}.db", now_ms()));
    if let Err(err) = fs::copy(path, &backup) {
        // a half copy must not push a good backup out of the rotation
        let _ = fs::remove_file(&backup);
        return Err(err.into());
    }
    let mut backups: Vec<_> = fs::read_dir(backups_dir)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("library-")))
        .collect();
    backups.sort();
    let excess = backups.len().saturating_sub(KEEP_BACKUPS);
    for old in &backups[..excess] {
        fs::remove_file(old)?;
    }
    Ok(())
}

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path, master: Option<&MasterKey>, backups_dir: &Path) -> Result<Self, StoreError> {
        Ok(Self::new(open_library(path, master, backups_dir)?))
    }

    pub fn new(conn: Connection) -> Self {
        Self { conn: Arc::new(Mutex::new(conn)) }
    }

    pub async fn call<R, F>(&self, f: F) -> Result<R, StoreError>
    where
        R: Send + 'static,
        F: FnOnce(&Connection) -> Result<R, StoreError> + Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            // A poisoned mutex still holds a usable connection: SQLite rolls back an unfinished statement
            let guard = conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            f(&guard)
        })
        .await
        .map_err(|e| StoreError::Task(e.to_string()))?
    }
}
