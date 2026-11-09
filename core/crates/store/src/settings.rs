use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::StoreError;

pub const RECOVERY_CONFIRMED: &str = "recovery_confirmed";
pub const CACHE_LIMIT_BYTES: &str = "cache_limit_bytes";
pub const DISPLAY_NAME: &str = "display_name";
pub const LASTFM_API_KEY: &str = "lastfm_api_key";
pub const LASTFM_API_SECRET: &str = "lastfm_api_secret";
pub const LASTFM_SESSION_KEY: &str = "lastfm_session_key";
pub const LASTFM_USER: &str = "lastfm_user";
pub const LASTFM_ENABLED: &str = "lastfm_enabled";
pub const LASTFM_LAST_ERROR: &str = "lastfm_last_error";
pub const IMPORT_PENDING_TRACK: &str = "import.pendingTrack";
pub const YOUTUBE_SESSION: &str = "youtube_session";
pub const YOUTUBE_PREFERENCES: &str = "youtube_preferences";
pub const SOUNDCLOUD_CLIENT_ID: &str = "soundcloud_client_id";
pub const SHORTCUTS: &str = "shortcuts";
pub const LYRICS_TRANSLATOR: &str = "lyrics_translator";

pub const STATS_PAUSED: &str = "stats.paused";

pub const APPEARANCE_THEMES: &str = "appearance.themes";
pub const APPEARANCE_ACTIVE: &str = "appearance.active";
pub const APPEARANCE_FONTS: &str = "appearance.fonts";
pub const APPEARANCE_FONT_FILES: &str = "appearance.fontFiles";
pub const APPEARANCE_CUSTOM_CSS: &str = "appearance.customCss";

pub fn get(conn: &Connection, key: &str) -> Result<Option<Value>, StoreError> {
    let raw: Option<String> = conn
        .query_row("SELECT value_json FROM settings_kv WHERE key = ?1", [key], |row| row.get(0))
        .optional()?;
    Ok(raw.map(|s| serde_json::from_str(&s)).transpose()?)
}

pub fn set(conn: &Connection, key: &str, value: &Value) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO settings_kv (key, value_json) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        params![key, value.to_string()],
    )?;
    Ok(())
}
