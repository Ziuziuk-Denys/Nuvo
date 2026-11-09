use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotInterestedRequest {
    pub track_id: String,
    /// `exact`, `work`, `artist` or `artist_forever`.
    pub scope: String,
    #[serde(default)]
    pub track: Option<Value>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotInterestedResult {
    pub suppression_id: i64,
    pub offer_hide_artist: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SuppressionItem {
    pub id: i64,
    /// `exact`, `work`, `artist` or `artist_forever`, as in the request.
    pub scope: String,
    /// `user` or `scrub_skip` (added automatically after a scrub-then-skip).
    pub origin: String,
    pub track: Option<Value>,
    pub penalty: f64,
    /// When the entry stops mattering (penalty under 0.05); `null` for entries that never fade.
    pub fades_at: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RankRequest {
    // `radio:<trackId>`, `continue:<contextId>`, `search:<trackId>`, `mix:mood:<key>` and others
    pub context: String,
    #[serde(default)]
    pub seeds: Vec<String>,
    /// Track snapshots in the catalog's order (at most 500).
    pub candidates: Vec<Value>,
    /// Track ids played or queued before this batch, oldest first.
    #[serde(default)]
    pub recent: Vec<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    /// JS `getTimezoneOffset()`, for the time-of-day affinity.
    #[serde(default)]
    pub tz_offset_min: Option<i64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct RankReason {
    /// `artist`, `similar`, `new`, `time` or `session`.
    pub kind: &'static str,
    /// Artist name for `artist`, the track title for `similar` and `session`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct RankedItem {
    pub track: Value,
    pub reason: RankReason,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
pub struct RankSignals {
    pub liked: usize,
    pub skipped: usize,
    pub scrubbed: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RankResponse {
    pub batch_id: String,
    pub items: Vec<RankedItem>,
    pub signals: RankSignals,
    pub dropped: usize,
}

#[derive(Serialize, Debug)]
pub struct SeedsResponse {
    /// Up to 12 track ids whose candidate lists are missing or older than 24 h.
    pub seeds: Vec<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PoolRequest {
    pub seed_id: String,
    pub source: String,
    /// Track snapshots in catalog order, at most 100.
    pub items: Vec<Value>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ExcludedItem {
    /// `playlist` or `track`.
    pub kind: String,
    pub id: String,
}
