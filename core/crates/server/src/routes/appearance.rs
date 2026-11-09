use std::collections::HashSet;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use nuvo_contracts::{Appearance, AppearancePatch, FontChoice, FontSettings, NuvoTheme};
use nuvo_store::{Connection, StoreError, settings};
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub const MAX_THEMES: usize = 50;
pub const MAX_THEME_BYTES: usize = 16 * 1024;
pub const MAX_CSS_BYTES: usize = 32 * 1024;
pub const MAX_FONT_FILES: usize = 20;
pub const MAX_FONT_BYTES: u64 = 64 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/appearance", get(read).patch(update))
}

fn clean_name(name: &str, max: usize) -> bool {
    let count = name.chars().count();
    count >= 1 && count <= max && !name.chars().any(|c| c.is_control() || matches!(c, ';' | '{' | '}' | '<' | '>' | '"' | '\'' | '\\'))
}

fn plain_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn font_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn colour(value: &str) -> bool {
    (1..=40).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_hexdigit() || b"#rgbRGBaA(),. ".contains(&b))
}

fn check_theme(theme: &NuvoTheme) -> Result<(), String> {
    if theme.format != "nuvo-theme" || theme.version != 1 {
        return Err("theme format must be nuvo-theme version 1".into());
    }
    if !plain_id(&theme.id) {
        return Err("theme id must be 1-64 letters, digits or dashes".into());
    }
    if !clean_name(&theme.name, 40) || theme.author.as_deref().is_some_and(|a| !clean_name(a, 60)) {
        return Err("theme name must be 1-40 characters and author at most 60".into());
    }
    let modes = [theme.modes.light.as_ref(), theme.modes.dark.as_ref()];
    if modes.iter().all(Option::is_none) {
        return Err("a theme needs a light or a dark mode".into());
    }
    if !modes.iter().flatten().all(|roles| roles.values().iter().all(|v| colour(v))) {
        return Err("theme colours must be #hex, rgb() or rgba()".into());
    }
    if theme.css.as_ref().is_some_and(|css| css.len() > MAX_CSS_BYTES) {
        return Err("theme CSS is over 32 KB".into());
    }
    if serde_json::to_vec(theme).map_or(true, |bytes| bytes.len() > MAX_THEME_BYTES + MAX_CSS_BYTES) {
        return Err("theme is too large".into());
    }
    Ok(())
}

fn check_fonts(fonts: &FontSettings) -> Result<(), String> {
    if !(0.9..=1.2).contains(&fonts.ui_scale) || !(0.8..=1.4).contains(&fonts.lyrics_scale) {
        return Err("uiScale must be 0.9-1.2 and lyricsScale 0.8-1.4".into());
    }
    for choice in [&fonts.ui, &fonts.lyrics] {
        match choice {
            FontChoice::Default {} => {}
            FontChoice::System { family } if clean_name(family, 100) => {}
            FontChoice::File { id } if font_id(id) => {}
            _ => return Err("font choice is invalid".into()),
        }
    }
    Ok(())
}

fn check(patch: &AppearancePatch) -> Result<(), String> {
    if let Some(themes) = &patch.themes {
        if themes.len() > MAX_THEMES {
            return Err(format!("at most {MAX_THEMES} themes"));
        }
        let mut ids = HashSet::new();
        for theme in themes {
            check_theme(theme)?;
            if !ids.insert(theme.id.as_str()) {
                return Err("theme ids must be unique".into());
            }
        }
    }
    if let Some(active) = &patch.active {
        let id = active.preset_id.strip_prefix("custom:").unwrap_or(&active.preset_id);
        if !plain_id(id) {
            return Err("presetId is invalid".into());
        }
    }
    if let Some(fonts) = &patch.fonts {
        check_fonts(fonts)?;
    }
    if let Some(files) = &patch.font_files {
        let total: u64 = files.iter().map(|f| f.bytes).sum();
        if files.len() > MAX_FONT_FILES || total > MAX_FONT_BYTES {
            return Err(format!("at most {MAX_FONT_FILES} font files and 64 MB"));
        }
        let mut ids = HashSet::new();
        if !files.iter().all(|f| font_id(&f.id) && clean_name(&f.family, 100) && ids.insert(f.id.as_str())) {
            return Err("font file entry is invalid".into());
        }
    }
    if patch.custom_css.as_ref().is_some_and(|css| css.text.len() > MAX_CSS_BYTES) {
        return Err("custom CSS is over 32 KB".into());
    }
    Ok(())
}

/// A stored value that no longer parses (an older shape) reads as the default instead of failing the screen.
fn stored<T: DeserializeOwned>(conn: &Connection, key: &str) -> Result<Option<T>, StoreError> {
    Ok(settings::get(conn, key)?.and_then(|value| serde_json::from_value(value).ok()))
}

fn load(conn: &Connection) -> Result<Appearance, StoreError> {
    let mut out = Appearance::default();
    if let Some(v) = stored(conn, settings::APPEARANCE_THEMES)? {
        out.themes = v;
    }
    if let Some(v) = stored(conn, settings::APPEARANCE_ACTIVE)? {
        out.active = v;
    }
    if let Some(v) = stored(conn, settings::APPEARANCE_FONTS)? {
        out.fonts = v;
    }
    if let Some(v) = stored(conn, settings::APPEARANCE_FONT_FILES)? {
        out.font_files = v;
    }
    if let Some(v) = stored(conn, settings::APPEARANCE_CUSTOM_CSS)? {
        out.custom_css = v;
    }
    Ok(out)
}

async fn read(State(state): State<AppState>) -> Result<Json<Appearance>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(load).await?))
}

async fn update(State(state): State<AppState>, JsonBody(patch): JsonBody<AppearancePatch>) -> Result<Json<Appearance>, ApiError> {
    check(&patch).map_err(ApiError::Invalid)?;
    let data = state.data()?;
    let appearance = data
        .db
        .call(move |c| {
            let tx = c.unchecked_transaction()?;
            let writes = [
                (settings::APPEARANCE_THEMES, patch.themes.map(|v| json!(v))),
                (settings::APPEARANCE_ACTIVE, patch.active.map(|v| json!(v))),
                (settings::APPEARANCE_FONTS, patch.fonts.map(|v| json!(v))),
                (settings::APPEARANCE_FONT_FILES, patch.font_files.map(|v| json!(v))),
                (settings::APPEARANCE_CUSTOM_CSS, patch.custom_css.map(|v| json!(v))),
            ];
            for (key, value) in writes {
                if let Some(value) = value {
                    settings::set(&tx, key, &value)?;
                }
            }
            tx.commit()?;
            load(c)
        })
        .await?;
    Ok(Json(appearance))
}
