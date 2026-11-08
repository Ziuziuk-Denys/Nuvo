use serde::{Deserialize, Serialize};

/// Which audio a match came from.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    /// The clean TikTok sound of the post.
    Clean,
    /// Left plus right.
    Mix,
    /// Left minus right, which cancels a centred voice-over.
    Side,
    /// A recording of the system audio monitor or the microphone.
    System,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InputKind {
    Link,
    File,
    System,
    Microphone,
}

impl InputKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Link => "link",
            Self::File => "file",
            // The table's CHECK knows three kinds and nothing reads the column; the stored result keeps the real one.
            Self::System | Self::Microphone => "system",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct InputInfo {
    pub kind: InputKind,
    pub label: String,
}

/// What Shazam says about a match.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub title: String,
    pub artist: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isrc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apple_music_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
    pub shazam_key: String,
    /// Where the sent window starts in the song.
    pub offset_ms: u64,
}

/// The wire and history shape: the song plus how it was found.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RecognizedTrack {
    #[serde(flatten)]
    pub song: Song,
    pub via: Via,
    pub input: InputInfo,
}
