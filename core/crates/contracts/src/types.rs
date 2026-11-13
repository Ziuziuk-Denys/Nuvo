// Track objects stay serde_json::Value: the daemon returns the renderer's snapshot verbatim

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// Absent field -> `None`, explicit `null` -> `Some(None)`.
fn double_option<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
    Deserialize::deserialize(d).map(Some)
}

/// Renderer durations can be fractional (`audio.duration * 1000`).
fn rounded_ms<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    Ok(f64::deserialize(d)?.round() as i64)
}

fn opt_rounded_ms<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    Ok(Option::<f64>::deserialize(d)?.map(|ms| ms.round() as i64))
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorBody {
    pub message: String,
    pub code: &'static str,
    pub req_id: String,
    /// Only on `SC_UNPLAYABLE`: why the track cannot be played.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

#[derive(Serialize, Debug)]
pub struct Health {
    pub status: &'static str,
    pub locked: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub passphrase: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct KeyStorage {
    pub protection: &'static str,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct PassphraseBody {
    pub passphrase: String,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct SetPassphrase {
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolStatusKind {
    Ok,
    Missing,
    Broken,
    Outdated,
}

impl Serialize for ToolStatusKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(match self {
            Self::Ok => "ok",
            Self::Missing => "missing",
            Self::Broken => "broken",
            Self::Outdated => "outdated",
        })
    }
}

// `status`: `ok`, `missing`, `broken` or `outdated`
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub status: ToolStatusKind,
    pub needed_by: &'static [&'static str],
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deps {
    pub checked_at: String,
    pub tools: Vec<ToolStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download: Option<ToolDownload>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDownload {
    pub tool: &'static str,
    pub received: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub failed: bool,
}

// `check`: dns, tcp, https, proxy, clock or tools; `code` is set only when the row failed
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetCheckRow {
    pub check: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<&'static str>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
    pub ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

// Code and service back the summary so the renderer can localise it; absent when all works
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetCheck {
    pub checked_at: String,
    pub rows: Vec<NetCheckRow>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<&'static str>,
}

// Daemon section of a bug report, already redacted; library fields are absent while locked
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DaemonReport {
    pub version: &'static str,
    pub uptime_secs: u64,
    /// `starting` or `ok`.
    pub phase: &'static str,
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<CacheStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deps: Option<Deps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_check: Option<NetCheck>,
    pub log: String,
}

// No Debug: the URL can carry proxy credentials
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkSettings {
    pub proxy_url: Option<String>,
}

// No Debug: the bridge URL carries its login
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkApplied {
    pub bridge_url: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: &'static str,
    pub username: &'static str,
    pub display_name: String,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfile {
    #[serde(default, deserialize_with = "double_option")]
    pub display_name: Option<Option<String>>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LikedTrackItem {
    pub track: Value,
    pub liked_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LikedTracksPage {
    pub items: Vec<LikedTrackItem>,
    pub next_cursor: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackBody {
    #[serde(default)]
    pub track: Option<Value>,
    #[serde(default)]
    pub track_snapshot: Option<Value>,
}

impl TrackBody {
    pub fn into_snapshot(self) -> Option<Value> {
        self.track.or(self.track_snapshot)
    }
}

#[derive(Deserialize, Debug, Default)]
pub struct SnapshotBody {
    #[serde(default)]
    pub snapshot: Option<Value>,
}

#[derive(Serialize, Debug)]
pub struct Items<T> {
    pub items: Vec<T>,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
pub struct ImportCounts {
    pub exact: i64,
    pub likely: i64,
    pub check: i64,
    pub missing: i64,
    pub already: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub id: String,
    pub source_kind: String,
    pub label: String,
    /// `playlist` or `liked`.
    pub target_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub created_at: String,
    /// `running` or `done`.
    pub status: String,
    pub total: i64,
    pub done: i64,
    pub needs_review: i64,
    pub counts: ImportCounts,
}

// `source` is the original line; `reason`: exact, matched, already_there or a match reason code
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    pub id: i64,
    pub position: i64,
    pub source: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<Value>,
    pub candidates: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_diff_ms: Option<i64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportRowsPage {
    pub items: Vec<ImportRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

// `kind`: `new` (default, named after the source), `playlist` (with `id`) or `liked`
#[derive(Deserialize, Debug, Clone)]
pub struct ImportTarget {
    pub kind: String,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct ImportFile {
    pub name: String,
    /// The file's bytes, base64: the daemon detects the text encoding itself.
    pub data: String,
}

// `source`: youtube-music, soundcloud, apple-music, deezer, nuvo-link or legacy
#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct StartImport {
    /// Main-only (`/v1/fs/imports`): a file the daemon reads itself.
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub file: Option<ImportFile>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub rows: Option<Vec<Value>>,
    #[serde(default)]
    pub target: Option<ImportTarget>,
}

// `filter`: songs, any or videos; `source`: youtube or soundcloud; `step` returns with candidates
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSearch {
    pub query: String,
    pub filter: String,
    pub source: String,
    pub step: usize,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum ImportNext {
    Search { row_id: i64, search: ImportSearch },
    Wait { wait: u64 },
    Done { done: bool },
}

#[derive(Deserialize, Debug)]
pub struct RowCandidates {
    pub step: usize,
    #[serde(default)]
    pub candidates: Vec<Value>,
    #[serde(default)]
    pub failed: bool,
}

// Accepts `use`, `pick` (with `track`), `remove` or `keep`
#[derive(Deserialize, Debug)]
pub struct RowDecision {
    pub decision: String,
    #[serde(default)]
    pub track: Option<Value>,
}

// Accepts `accept-check` or `retry-failed`
#[derive(Deserialize, Debug)]
pub struct ImportBulk {
    pub action: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchEntry {
    pub id: String,
    /// `query`, `track`, `artist`, `album` or `playlist`.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<Value>,
    pub at: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AddSearch {
    pub kind: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub item: Option<Value>,
}

// Pinned items come first, in pin order, then hidden ones
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFlag {
    /// `playlist`, `album` or `artist`.
    pub kind: String,
    pub id: String,
    pub pinned: bool,
    pub hidden: bool,
    /// Title and cover, so a pinned external item renders offline.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Value>,
    pub updated_at: String,
}

// Absent fields stay as they are
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetFlag {
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub snapshot: Option<Value>,
}

#[derive(Deserialize, Debug)]
pub struct FlagKey {
    pub kind: String,
    pub id: String,
}

#[derive(Deserialize, Debug)]
pub struct PinOrder {
    pub items: Vec<FlagKey>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserPlaylist {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub is_public: bool,
    pub pinned_offline: bool,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
    pub owner_id: &'static str,
    pub sort_mode: String,
    pub sort_desc: bool,
    /// `nuvo-core://local/v1/me/playlists/<id>/cover?v=<updated_at>` when a custom cover exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistListItem {
    #[serde(flatten)]
    pub playlist: UserPlaylist,
    pub track_count: i64,
    pub covers: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserPlaylistItem {
    pub id: String,
    pub track: Value,
    pub position: f64,
    pub added_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistWithItems {
    pub playlist: UserPlaylist,
    pub items: Vec<UserPlaylistItem>,
    /// Set only when the detail was asked for with `?limit=`: then `items` is the first page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

// `nextCursor` is absent on the last page; `total` counts the items that match `q`
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItemsPage {
    pub items: Vec<UserPlaylistItem>,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct BulkAddResult {
    pub items: Vec<UserPlaylistItem>,
    pub added: usize,
    pub rejected: usize,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlaylist {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: bool,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlaylist {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub is_public: Option<bool>,
    #[serde(default)]
    pub pinned_offline: Option<bool>,
    #[serde(default)]
    pub sort_mode: Option<String>,
    #[serde(default)]
    pub sort_desc: Option<bool>,
}

#[derive(Deserialize, Debug)]
pub struct BulkTracks {
    pub tracks: Vec<Value>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MoveItem {
    pub before_item_id: Option<String>,
    pub revision: i64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemIds {
    pub item_ids: Vec<String>,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TransferMode {
    Copy,
    Move,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransferItems {
    pub item_ids: Vec<String>,
    pub target_id: String,
    pub mode: TransferMode,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InsertItem {
    pub track_id: String,
    pub position: f64,
    pub added_at: String,
}

#[derive(Deserialize, Debug)]
pub struct InsertItems {
    pub items: Vec<InsertItem>,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergePlaylists {
    pub source_ids: Vec<String>,
    #[serde(default = "yes")]
    pub skip_duplicates: bool,
    #[serde(default)]
    pub delete_sources: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub added: usize,
    /// The new target items, for the undo through `items/remove` (in chunks of 5,000).
    pub added_item_ids: Vec<String>,
    pub skipped: usize,
    pub deleted_source_ids: Vec<String>,
    pub snapshots: Vec<PlaylistSnapshot>,
    pub revision: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSnapshot {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub is_public: bool,
    pub pinned_offline: bool,
    pub sort_mode: String,
    pub sort_desc: bool,
    pub created_at: String,
    pub revision: i64,
    pub items: Vec<InsertItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<CoverSnapshot>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CoverSnapshot {
    pub mime: String,
    pub base64: String,
}

#[derive(Deserialize, Debug)]
pub struct RestorePlaylists {
    pub snapshots: Vec<PlaylistSnapshot>,
}

#[derive(Serialize, Debug)]
pub struct RemoveResult {
    pub removed: usize,
    pub revision: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub added: Vec<UserPlaylistItem>,
    pub skipped: usize,
    pub removed: usize,
    pub source_revision: i64,
    pub target_revision: i64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct OfflineProgress {
    pub cached: i64,
    pub total: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackTrim {
    pub track_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

// `track` is the snapshot, for tracks the library has not seen yet
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetTrim {
    #[serde(deserialize_with = "rounded_ms")]
    pub start_ms: i64,
    #[serde(deserialize_with = "rounded_ms")]
    pub end_ms: i64,
    #[serde(default)]
    pub track: Option<Value>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LastfmStatus {
    pub has_credentials: bool,
    pub connected: bool,
    pub user: Option<String>,
    pub enabled: bool,
    pub queued: i64,
    pub last_error: Option<String>,
}

// Every field is optional. No Debug: it holds the secret
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LastfmSettings {
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_secret: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LastfmToken {
    pub token: String,
    pub auth_url: String,
}

#[derive(Deserialize, Debug)]
pub struct LastfmSessionRequest {
    pub token: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub track_id: String,
    #[serde(default)]
    pub track_snapshot: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PlaybackContext {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecordPlaybackEvent {
    pub listening_session_id: String,
    pub track_id: String,
    #[serde(default)]
    pub track_snapshot: Option<Value>,
    #[serde(deserialize_with = "rounded_ms")]
    pub played_duration_ms: i64,
    #[serde(default, deserialize_with = "opt_rounded_ms")]
    pub track_duration_ms: Option<i64>,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default)]
    pub loop_count: i64,
    #[serde(default)]
    pub has_seek_backward: bool,
    #[serde(default)]
    pub context: Option<PlaybackContext>,
    #[serde(default)]
    pub end_reason: Option<String>,
    #[serde(default)]
    pub position_in_session: Option<i64>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub tz_offset_min: Option<i64>,
    /// Total forward jumps over 3 s, in ms. Older clients omit it.
    #[serde(default, deserialize_with = "rounded_ms")]
    pub seek_forward_ms: i64,
    /// Where the audio came from: `youtube`, `soundcloud`, `cache` or `local`. Older clients omit it.
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackHistoryItem {
    pub id: String,
    pub playback_session_id: String,
    pub listening_session_id: String,
    pub track: Value,
    pub played_duration_ms: i64,
    pub completion_rate: f64,
    pub completed: bool,
    pub skipped: bool,
    pub loop_count: i64,
    pub has_seek_backward: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<PlaybackContext>,
    pub listened_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackHistoryResponse {
    pub items: Vec<PlaybackHistoryItem>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct Viewer {
    pub liked: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PopularTrackItem {
    pub rank: usize,
    pub track: Value,
    pub play_count: i64,
    pub unique_listeners: i64,
    pub score: f64,
    pub viewer: Viewer,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PopularTracksResponse {
    pub window: String,
    pub generated_at: String,
    pub items: Vec<PopularTrackItem>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PopularAlbumEntry {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub play_count: i64,
    pub unique_listeners: i64,
    pub track_count: i64,
    pub score: f64,
}

#[derive(Serialize, Debug)]
pub struct PopularAlbumsResponse {
    pub window: String,
    pub items: Vec<PopularAlbumEntry>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MostSavedEntry {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub cover_url: Option<String>,
    pub saves: i64,
}

#[derive(Serialize, Debug)]
pub struct MostSavedResponse {
    #[serde(rename = "type")]
    pub kind: String,
    pub items: Vec<MostSavedEntry>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DailyMixItem {
    pub id: String,
    pub title: String,
    pub description: String,
    pub cluster_artists: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<Value>,
    pub track_count: usize,
    pub tracks: Vec<Value>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DailyMixesResponse {
    pub items: Vec<DailyMixItem>,
    pub generated_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct LyricsQuality {
    pub total: f64,
    #[serde(rename = "match")]
    pub match_score: f64,
    pub content: f64,
    pub sync: f64,
    pub source: f64,
    pub reasons: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RawLyrics {
    pub format: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchedTrack {
    pub title: String,
    pub artists: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricsCandidate {
    pub provider: String,
    pub content_kind: String,
    pub sync_level: String,
    pub quality: LyricsQuality,
    pub lyrics: RawLyrics,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_track: Option<MatchedTrack>,
    /// User lyrics: shown before every provider.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub top_priority: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricsTrackMeta {
    pub id: String,
    pub title: String,
    pub artists: Vec<Value>,
    pub duration_ms: i64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricsBest {
    pub provider: String,
    pub quality: f64,
    pub sync_level: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LyricsStreamEvent {
    Metadata {
        track: LyricsTrackMeta,
        offset_ms: i64,
    },
    Provider {
        provider: String,
        status: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        sync_level: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        candidate: Option<Box<LyricsCandidate>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        duration_ms: i64,
    },
    Done {
        cached: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        best: Option<LyricsBest>,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<&'static str>,
    },
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetLyricsOffset {
    #[serde(deserialize_with = "rounded_ms")]
    pub offset_ms: i64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetUserLyrics {
    pub format: String,
    pub content: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricsOffset {
    pub offset_ms: i64,
}

#[derive(Deserialize, Debug)]
pub struct ImportLyricsOffsets {
    pub offsets: std::collections::HashMap<String, f64>,
}

#[derive(Serialize, Debug)]
pub struct ImportedLyricsOffsets {
    pub imported: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    pub used_bytes: i64,
    pub limit_bytes: i64,
    pub entries: i64,
    pub pinned: i64,
    pub covers: CoverStats,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoverStats {
    pub bytes: i64,
    pub count: i64,
    pub limit_bytes: i64,
}

// No Debug: the URL carries a signed stream address
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    pub track_id: String,
    pub url: String,
    pub mime: String,
    #[serde(default)]
    pub codec: Option<String>,
    /// Accepted now and stored once the cache index has a bitrate column.
    #[serde(default)]
    pub bitrate_kbps: Option<u32>,
    #[serde(default)]
    pub content_length: Option<u64>,
}

/// `state`: `queued`, `fetching`, `done` or `failed` (with `code`).
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct FetchStatus {
    pub state: &'static str,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CacheSettings {
    pub limit_bytes: Option<i64>,
    pub covers_limit_bytes: Option<i64>,
}

#[derive(Serialize, Debug)]
pub struct RecoveryPhrase {
    pub phrase: String,
}

#[derive(Deserialize, Debug)]
pub struct RestoreRequest {
    pub phrase: String,
}

// No Debug: it holds the tokens
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeSession {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    /// Unix milliseconds.
    pub expires_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YoutubePreferences {
    pub play_through_account: bool,
    pub offer_sign_in: bool,
    pub show_account_playlists: bool,
}

impl Default for YoutubePreferences {
    // `offerSignIn` is off: Nuvo needs no account
    fn default() -> Self {
        Self { play_through_account: true, offer_sign_in: false, show_account_playlists: true }
    }
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct YoutubePreferencesPatch {
    #[serde(default)]
    pub play_through_account: Option<bool>,
    #[serde(default)]
    pub offer_sign_in: Option<bool>,
    #[serde(default)]
    pub show_account_playlists: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeAccount {
    pub session: Option<YoutubeSession>,
    pub preferences: YoutubePreferences,
}

// `added` lists the ids this request liked, exactly what its undo may unlike
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BulkLikeResult {
    pub added: Vec<String>,
    pub already_liked: usize,
    pub rejected: usize,
}

#[derive(Deserialize, Debug)]
pub struct TrackIds {
    pub ids: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct RemovedCount {
    pub removed: usize,
}
