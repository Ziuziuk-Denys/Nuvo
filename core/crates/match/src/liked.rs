//! One copy of a song in Liked songs: the single and its album release are the same song.

use nuvo_store::{Connection, StoreError, library};
use serde_json::Value;

use crate::decide::same_liked_track;

/// Whether two track snapshots are one recording in one version.
pub fn same_song(a: &Value, b: &Value) -> bool {
    let fields = |track: &Value| {
        let artists: Vec<String> = track["artists"].as_array().map(|list| list.iter().filter_map(|a| a["name"].as_str().map(String::from)).collect()).unwrap_or_default();
        (track["title"].as_str().unwrap_or_default().to_string(), artists, track["durationMs"].as_i64())
    };
    let ((a_title, a_artists, a_ms), (b_title, b_artists, b_ms)) = (fields(a), fields(b));
    same_liked_track(&a_title, &a_artists, a_ms, &b_title, &b_artists, b_ms)
}

/// The liked songs as snapshots, read once for a batch of likes.
pub struct LikedIndex {
    songs: Vec<(String, Value)>,
}

impl LikedIndex {
    pub fn load(conn: &Connection) -> Result<Self, StoreError> {
        Ok(Self { songs: library::liked_snapshots(conn)? })
    }

    /// A liked song under another id that is the same song as `snapshot`.
    pub fn has_twin(&self, id: &str, snapshot: &Value) -> bool {
        self.songs.iter().any(|(other, old)| other != id && same_song(snapshot, old))
    }

    pub fn add(&mut self, id: String, snapshot: Value) {
        self.songs.push((id, snapshot));
    }
}
