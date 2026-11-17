use std::sync::{Arc, Mutex};

use nuvo_crypto::{MasterKey, base64_decode, base64_encode, derive_key, open_value, seal_value};
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
pub const LYRICS_WORD_TIMING: &str = "lyrics_word_timing";

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

pub const SECRETS: [&str; 3] = [LASTFM_API_SECRET, LASTFM_SESSION_KEY, YOUTUBE_SESSION];
const SECRETS_KEY_INFO: &str = "nuvo/secrets/v1";
const SEALED_PREFIX: &str = "sealed1:";

type KeySource = dyn Fn() -> Result<MasterKey, StoreError> + Send + Sync;

/// How service tokens are kept: as they are inside an encrypted library, sealed by the system keyring inside a plain one.
#[derive(Clone)]
pub enum Secrets {
    Clear,
    Sealed(Arc<Sealer>),
}

pub struct Sealer {
    key: Mutex<Option<[u8; 32]>>,
    load: Box<KeySource>,
}

impl Secrets {
    /// `load` runs at most once, on the first secret read or written.
    pub fn sealed(load: impl Fn() -> Result<MasterKey, StoreError> + Send + Sync + 'static) -> Self {
        Self::Sealed(Arc::new(Sealer { key: Mutex::new(None), load: Box::new(load) }))
    }
}

impl Sealer {
    fn key(&self) -> Result<[u8; 32], StoreError> {
        let mut key = self.key.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(key) = *key {
            return Ok(key);
        }
        let derived = derive_key(&(self.load)()?, SECRETS_KEY_INFO);
        *key = Some(derived);
        Ok(derived)
    }
}

pub fn get_secret(conn: &Connection, secrets: &Secrets, key: &str) -> Result<Option<Value>, StoreError> {
    let value = get(conn, key)?;
    let (Secrets::Sealed(sealer), Some(Value::String(text))) = (secrets, &value) else { return Ok(value) };
    let Some(sealed) = text.strip_prefix(SEALED_PREFIX) else { return Ok(value) };
    let bytes = base64_decode(sealed).ok_or_else(|| StoreError::Invalid(format!("{key} is damaged")))?;
    let plain = open_value(&sealer.key()?, &bytes).map_err(|_| StoreError::Invalid(format!("{key} was sealed with another key")))?;
    Ok(Some(serde_json::from_slice(&plain)?))
}

pub fn set_secret(conn: &Connection, secrets: &Secrets, key: &str, value: &Value) -> Result<(), StoreError> {
    match secrets {
        Secrets::Sealed(sealer) if !value.is_null() => {
            let sealed = seal_value(&sealer.key()?, value.to_string().as_bytes());
            set(conn, key, &Value::String(format!("{SEALED_PREFIX}{}", base64_encode(&sealed))))
        }
        _ => set(conn, key, value),
    }
}

/// Moves every stored token not yet kept the way `to` keeps it; the key is fetched only when one has to move.
pub fn reseal(conn: &Connection, from: &Secrets, to: &Secrets) -> Result<(), StoreError> {
    for key in SECRETS {
        let sealed = match get(conn, key)? {
            None | Some(Value::Null) => continue,
            Some(Value::String(text)) => text.starts_with(SEALED_PREFIX),
            Some(_) => false,
        };
        if sealed == matches!(to, Secrets::Sealed(_)) {
            continue;
        }
        if let Some(value) = get_secret(conn, from, key)? {
            set_secret(conn, to, key, &value)?;
        }
    }
    Ok(())
}
