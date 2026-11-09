use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One period's numbers. A play counts when it completed or ran 30 s; time is real played time.
#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsTotals {
    pub listened_ms: i64,
    pub plays: i64,
    pub tracks: i64,
    pub artists: i64,
    pub albums: i64,
    pub active_days: i64,
    pub sessions: i64,
    /// Share of plays that were skipped under 30 s, 0 to 1.
    pub skip_rate: f64,
    /// Share of plays heard to the end, 0 to 1.
    pub completed_rate: f64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsRange {
    /// First and last local day, `YYYY-MM-DD`, both inside; null only while nothing was ever played.
    pub from: Option<String>,
    pub to: String,
    pub days: i64,
    pub previous_from: Option<String>,
    pub previous_to: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsDay {
    pub day: String,
    pub listened_ms: i64,
    pub plays: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsShare {
    pub kind: String,
    pub plays: i64,
    pub listened_ms: i64,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsStreak {
    pub days: i64,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsSessions {
    pub count: i64,
    pub average_ms: i64,
    pub longest_ms: i64,
    pub longest_started_at: Option<String>,
    pub longest_tracks: i64,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsRow {
    /// Track id, artist key, album key, playlist id or genre name.
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    pub plays: i64,
    pub listened_ms: i64,
    pub rank: i64,
    /// Places gained since the previous period; null when it was not ranked then.
    pub rank_delta: Option<i64>,
    pub is_new: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replays: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_played_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<String>,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsTop {
    pub tracks: Vec<StatsRow>,
    pub artists: Vec<StatsRow>,
    pub albums: Vec<StatsRow>,
    pub playlists: Vec<StatsRow>,
    pub genres: Vec<StatsRow>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsOverview {
    pub range: StatsRange,
    pub totals: StatsTotals,
    /// The previous period of the same length; null for all time.
    pub previous: Option<StatsTotals>,
    pub new_tracks: i64,
    pub new_artists: i64,
    /// Consecutive local days with a play, ending today or yesterday, whatever the period.
    pub current_streak: i64,
    pub longest_streak: StatsStreak,
    pub first_played_at: Option<String>,
    /// Listening time and plays per local day of the period; days without plays are absent.
    pub days: Vec<StatsDay>,
    /// The 53 weeks up to the period's end, for the calendar.
    pub calendar: Vec<StatsDay>,
    /// Time by local hour, 0 to 23.
    pub by_hour: Vec<i64>,
    /// Time by local weekday, 0 is Sunday.
    pub by_weekday: Vec<i64>,
    pub sources: Vec<StatsShare>,
    /// Where the audio came from: stream, cache or local.
    pub origins: Vec<StatsShare>,
    pub sessions: StatsSessions,
    pub top: StatsTop,
    pub most_skipped: Vec<StatsRow>,
    pub most_replayed: Vec<StatsRow>,
    pub on_repeat: Vec<StatsRow>,
    pub discoveries: Vec<StatsRow>,
    pub forgotten: Vec<StatsRow>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsMonth {
    /// `YYYY-MM`.
    pub month: String,
    pub plays: i64,
    pub listened_ms: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsDetail {
    pub title: String,
    pub subtitle: Option<String>,
    pub cover_url: Option<String>,
    /// The track's snapshot; null on an artist.
    pub track: Option<Value>,
    pub open_id: Option<String>,
    pub first_played_at: Option<String>,
    pub last_played_at: Option<String>,
    pub plays: i64,
    pub listened_ms: i64,
    pub skips: i64,
    pub completed: i64,
    pub active_days: i64,
    pub by_month: Vec<StatsMonth>,
    pub by_hour: Vec<i64>,
    pub by_weekday: Vec<i64>,
    pub sources: Vec<StatsShare>,
    pub top_tracks: Vec<StatsRow>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsContextPlays {
    pub kind: String,
    pub id: String,
    pub plays: i64,
    pub last_played_at: String,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsCollection {
    pub paused: bool,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsDeleteRequest {
    /// Both or neither: first and last local day to delete, `YYYY-MM-DD`; neither deletes everything.
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsDeleted {
    pub events: i64,
}
