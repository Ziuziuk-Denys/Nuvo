//! Appearance settings (customization design 3). Typed with unknown fields refused, so the
//! renderer cannot keep other data under `appearance.*`.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ThemeRoles {
    pub field: String,
    pub deep: String,
    pub raised: String,
    pub ink: String,
    pub ink2: String,
    pub ink3: String,
    pub hair: String,
    pub tint: String,
    pub accent: String,
}

impl ThemeRoles {
    pub fn values(&self) -> [&str; 9] {
        [&self.field, &self.deep, &self.raised, &self.ink, &self.ink2, &self.ink3, &self.hair, &self.tint, &self.accent]
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct ThemeModes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light: Option<ThemeRoles>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dark: Option<ThemeRoles>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NuvoTheme {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub modes: ThemeModes,
    pub default_mode: ThemeMode,
    /// Optional CSS carried by a shared theme; the renderer asks before it enables it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveLook {
    /// A built-in preset id or `custom:<themeId>`.
    pub preset_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum FontChoice {
    // a struct variant, so `deny_unknown_fields` also refuses extra keys next to `"kind": "default"`
    Default {},
    System { family: String },
    File { id: String },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontSettings {
    pub ui: FontChoice,
    pub lyrics: FontChoice,
    pub ui_scale: f64,
    pub lyrics_scale: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FontFormat {
    Ttf,
    Otf,
    Woff2,
}

/// A font file main copied to `<userData>/fonts/<id>.<format>`; `id` is its SHA-256.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontFile {
    pub id: String,
    pub family: String,
    pub format: FontFormat,
    pub bytes: u64,
    pub added_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct CustomCss {
    pub enabled: bool,
    pub text: String,
}

/// `GET /v1/appearance`: every key, defaults for the ones never written.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub themes: Vec<NuvoTheme>,
    pub active: ActiveLook,
    pub fonts: FontSettings,
    pub font_files: Vec<FontFile>,
    pub custom_css: CustomCss,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            themes: Vec::new(),
            active: ActiveLook { preset_id: "nuvo".into() },
            fonts: FontSettings { ui: FontChoice::Default {}, lyrics: FontChoice::Default {}, ui_scale: 1.0, lyrics_scale: 1.0 },
            font_files: Vec::new(),
            custom_css: CustomCss::default(),
        }
    }
}

/// `PATCH /v1/appearance`: each present key replaces the stored one.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppearancePatch {
    #[serde(default)]
    pub themes: Option<Vec<NuvoTheme>>,
    #[serde(default)]
    pub active: Option<ActiveLook>,
    #[serde(default)]
    pub fonts: Option<FontSettings>,
    #[serde(default)]
    pub font_files: Option<Vec<FontFile>>,
    #[serde(default)]
    pub custom_css: Option<CustomCss>,
}
