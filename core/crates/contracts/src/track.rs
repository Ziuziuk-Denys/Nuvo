use serde_json::{Value, json};

pub const MAX_TRACK_ID_LEN: usize = 256;

// The renderer's snapshot is stored verbatim, so fields this struct ignores still round-trip
#[derive(Debug, Clone, PartialEq)]
pub struct TrackFields {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub artists_json: String,
    pub album: Option<String>,
    pub album_id: Option<String>,
    pub duration_ms: i64,
    pub cover_url: Option<String>,
    pub source: &'static str,
}

#[derive(Debug, thiserror::Error)]
#[error("invalid track snapshot: {0}")]
pub struct InvalidTrack(pub &'static str);

fn str_field(value: Option<&Value>, key: &str) -> Option<String> {
    value?.get(key)?.as_str().map(str::to_string)
}

impl TrackFields {
    pub fn from_snapshot(snapshot: &Value) -> Result<Self, InvalidTrack> {
        let obj = snapshot.as_object().ok_or(InvalidTrack("not an object"))?;
        let id = obj
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= MAX_TRACK_ID_LEN)
            .ok_or(InvalidTrack("id"))?;
        let artists = obj.get("artists").and_then(Value::as_array).cloned().unwrap_or_default();
        let artist = str_field(artists.first(), "name").unwrap_or_default();
        Ok(Self {
            id: id.to_string(),
            title: obj.get("title").and_then(Value::as_str).unwrap_or_default().to_string(),
            artist,
            artists_json: Value::Array(artists).to_string(),
            album: str_field(obj.get("album"), "title"),
            album_id: str_field(obj.get("album"), "id").filter(|id| !id.is_empty()),
            duration_ms: obj.get("durationMs").and_then(Value::as_f64).map_or(0, |ms| ms.round() as i64),
            cover_url: str_field(obj.get("cover"), "url"),
            source: source_of(id),
        })
    }
}

pub fn source_of(track_id: &str) -> &'static str {
    if track_id.starts_with("sc:") {
        "soundcloud"
    } else if track_id.starts_with("local:") {
        "local"
    } else {
        "youtube"
    }
}

pub fn with_viewer(mut snapshot: Value, liked: bool) -> Value {
    if let Some(obj) = snapshot.as_object_mut() {
        obj.insert("viewer".into(), json!({ "liked": liked }));
    }
    snapshot
}
