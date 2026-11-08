//! Saved copies: a safe file name, the extension of a cached format, tags written into the copy.

use std::path::Path;

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::Tag;

use crate::tags::TagError;

const MAX_NAME_BYTES: usize = 120;
/// Direction controls that can make a name read differently from what it is.
fn is_bidi_control(c: char) -> bool {
    matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}')
}

/// Refused by Windows or FAT drives as well as `/`; a USB stick must take the copy.
const UNSAFE: &str = "/\\:*?\"<>|";

pub fn file_name(artists: &str, title: &str, ext: &str) -> String {
    let base = if artists.trim().is_empty() { title.trim().to_string() } else { format!("{} - {}", artists.trim(), title.trim()) };
    let replaced: String = base.chars().filter(|c| !is_bidi_control(*c)).map(|c| if c.is_control() || UNSAFE.contains(c) { '_' } else { c }).collect();
    let trimmed = replaced.trim_matches(|c: char| c == '.' || c.is_whitespace());
    let name = if trimmed.is_empty() { "Track" } else { trimmed };
    let mut cut = MAX_NAME_BYTES.min(name.len());
    while !name.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}.{ext}", name[..cut].trim_end())
}

/// The ffmpeg demuxer for a saved extension, so it never has to guess the input.
pub fn input_format(ext: &str) -> Option<&'static str> {
    match ext {
        "mp3" => Some("mp3"),
        "m4a" => Some("mov"),
        "aac" => Some("aac"),
        "flac" => Some("flac"),
        "ogg" | "opus" => Some("ogg"),
        "webm" => Some("matroska"),
        "wav" => Some("wav"),
        _ => None,
    }
}

pub fn extension_for(mime: &str, codec: Option<&str>) -> &'static str {
    let mime = mime.to_ascii_lowercase();
    let codec = codec.unwrap_or("").to_ascii_lowercase();
    if mime.starts_with("audio/mpeg") {
        "mp3"
    } else if mime.starts_with("audio/mp4") || mime.starts_with("video/mp4") {
        "m4a"
    } else if mime.starts_with("audio/aac") {
        "aac"
    } else if mime.starts_with("audio/flac") {
        "flac"
    } else if mime.starts_with("audio/ogg") {
        if codec.contains("vorbis") { "ogg" } else { "opus" }
    } else if mime.starts_with("audio/webm") || mime.starts_with("video/webm") {
        "webm"
    } else if mime.starts_with("audio/wav") || mime.starts_with("audio/x-wav") {
        "wav"
    } else {
        "bin"
    }
}

pub struct SaveTags<'a> {
    pub title: &'a str,
    pub artists: &'a str,
    pub album: Option<&'a str>,
    /// Image bytes and their MIME type; only JPEG and PNG are embedded.
    pub cover: Option<(&'a [u8], &'a str)>,
}

/// Writes the tags in the container's own format (ID3v2, Vorbis comments, MP4, RIFF INFO).
pub fn write_tags(path: &Path, tags: &SaveTags) -> Result<(), TagError> {
    crate::tags::cap_allocations(crate::tags::MAX_TAG_ITEM_BYTES);
    // by content, not by extension: the part file being tagged has none
    let file = std::fs::File::open(path)?;
    let tagged = lofty::probe::Probe::new(std::io::BufReader::new(file)).guess_file_type()?.read().map_err(|e| TagError::Parse(e.to_string()))?;
    let mut tag = Tag::new(tagged.primary_tag_type());
    tag.set_title(tags.title.to_string());
    tag.set_artist(tags.artists.to_string());
    if let Some(album) = tags.album {
        tag.set_album(album.to_string());
    }
    let mime = match tags.cover.map(|(_, mime)| mime) {
        Some("image/jpeg") => Some(MimeType::Jpeg),
        Some("image/png") => Some(MimeType::Png),
        _ => None,
    };
    if let (Some((bytes, _)), Some(mime)) = (tags.cover, mime) {
        tag.push_picture(Picture::unchecked(bytes.to_vec()).pic_type(PictureType::CoverFront).mime_type(mime).build());
    }
    tag.save_to_path(path, WriteOptions::default()).map_err(|e| TagError::Parse(e.to_string()))
}
