use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalRoot {
    pub id: i64,
    pub path: String,
    pub added_at: i64,
    pub last_scan_at: Option<i64>,
    /// `ok`, or `missing` while the folder cannot be reached (an unplugged drive).
    pub status: String,
    pub files: i64,
}

#[derive(Deserialize, Debug)]
pub struct AddLocalRoot {
    pub path: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrackItem {
    pub track: Value,
    pub codec: String,
    pub bitrate_kbps: Option<i64>,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub lossless: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<String>,
    pub has_lyrics: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalTracksPage {
    pub items: Vec<LocalTrackItem>,
    pub next_cursor: Option<String>,
    pub total: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LocalRelated {
    pub seed: Option<Value>,
    pub items: Vec<Value>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LocalStyle {
    pub genre: Option<String>,
    pub items: Vec<Value>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalScanStatus {
    pub scanning: bool,
    pub root_id: Option<i64>,
    pub total: u64,
    pub read: u64,
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub unreadable: u64,
    pub skipped_links: u64,
    pub truncated: bool,
    pub watching: u64,
    /// True when a folder could not be watched (inotify limit); it is rescanned every 15 minutes.
    pub polling: bool,
    pub last_scan_at: Option<i64>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartDownload {
    pub dir: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub track_ids: Vec<String>,
    #[serde(default)]
    pub playlist_id: Option<String>,
    #[serde(default)]
    pub liked: bool,
    #[serde(default)]
    pub playlist_file: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSummary {
    pub id: String,
    pub label: String,
    pub dir: String,
    pub format: String,
    /// `running`, `done` or `cancelled`.
    pub status: String,
    pub total: i64,
    pub done: i64,
    pub failed: i64,
    pub waiting: i64,
    pub created_at: i64,
}
