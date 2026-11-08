//! What a local file is: tags, length and format read with lofty, its cover, its id and snapshot.

use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use lofty::config::{GlobalOptions, ParseOptions, apply_global_options};
use lofty::file::{FileType, TaggedFile};
use lofty::iff::wav::{WavFile, WavFormat};
use lofty::mp4::{Mp4Codec, Mp4File};
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::probe::Probe;
use nuvo_crypto::sha256_hex;
use serde_json::{Value, json};

use crate::open::{open_inside, open_regular};
use crate::walk::folder_art;

/// Where the daemon serves a local cover; part of every local snapshot.
pub const COVER_BASE: &str = "nuvo-core://local/v1/local/tracks/";
const MAX_TEXT_CHARS: usize = 512;
const MAX_COVER_BYTES: u64 = 8 * 1024 * 1024;
/// Tag reading skips pictures, so the limit only guards text, lyrics and other frames.
pub(crate) const MAX_TAG_ITEM_BYTES: u64 = 32 * 1024 * 1024;

/// Lofty keeps its allocation limit per thread and reads a tag item fully into memory. Set on
/// every entry point (scanner and request threads differ) so a hostile item fails early.
pub(crate) fn cap_allocations(bytes: u64) {
    apply_global_options(GlobalOptions::new().allocation_limit(bytes as usize));
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct LocalMeta {
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub year: Option<u16>,
    pub genre: Option<String>,
    pub duration_ms: i64,
    pub codec: &'static str,
    pub mime: &'static str,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub lossless: bool,
    /// Why the player cannot decode it (`alac`, `wav_codec`, `format`, `unreadable`).
    pub unsupported: Option<&'static str>,
}

#[derive(Debug, thiserror::Error)]
pub enum TagError {
    #[error("the file cannot be opened: {0}")]
    Io(#[from] std::io::Error),
    #[error("the file is not readable audio: {0}")]
    Parse(String),
}

fn parse_error(err: impl std::fmt::Display) -> TagError {
    TagError::Parse(err.to_string())
}

fn clean(text: &str) -> Option<String> {
    let text: String = text.chars().filter(|c| !c.is_control()).collect();
    let text: String = text.trim().chars().take(MAX_TEXT_CHARS).collect();
    let text = text.trim_end();
    (!text.is_empty()).then(|| text.to_string())
}

/// Codec, MIME type, lossless and the reason Chromium cannot play it, per container and content.
pub fn format_of(file_type: FileType, mp4: Option<Mp4Codec>, wav: Option<WavFormat>) -> (&'static str, &'static str, bool, Option<&'static str>) {
    match file_type {
        FileType::Mpeg => ("mp3", "audio/mpeg", false, None),
        FileType::Flac => ("flac", "audio/flac", true, None),
        FileType::Opus => ("opus", "audio/ogg", false, None),
        FileType::Vorbis => ("vorbis", "audio/ogg", false, None),
        FileType::Aac => ("aac", "audio/aac", false, None),
        FileType::Mp4 => match mp4 {
            Some(Mp4Codec::ALAC) => ("alac", "audio/mp4", true, Some("alac")),
            Some(Mp4Codec::FLAC) => ("flac", "audio/mp4", true, None),
            Some(Mp4Codec::MP3) => ("mp3", "audio/mp4", false, None),
            _ => ("aac", "audio/mp4", false, None),
        },
        FileType::Wav => match wav {
            None | Some(WavFormat::PCM) | Some(WavFormat::IEEE_FLOAT) => ("pcm", "audio/wav", true, None),
            Some(_) => ("wav", "audio/wav", false, Some("wav_codec")),
        },
        _ => ("unknown", "application/octet-stream", false, Some("format")),
    }
}

/// Title and artist from "Artist - Title.ext": for files without tags or that cannot be read.
pub fn meta_from_name(path: &Path) -> LocalMeta {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown");
    let (artists, title) = match stem.split_once(" - ") {
        Some((artist, title)) if !artist.trim().is_empty() && !title.trim().is_empty() => (clean(artist).into_iter().collect(), clean(title)),
        _ => (Vec::new(), clean(stem)),
    };
    LocalMeta {
        title: title.unwrap_or_else(|| "Unknown".into()),
        artists,
        codec: "unknown",
        mime: "application/octet-stream",
        unsupported: Some("unreadable"),
        ..LocalMeta::default()
    }
}

pub fn read_meta(path: &Path) -> Result<LocalMeta, TagError> {
    cap_allocations(MAX_TAG_ITEM_BYTES);
    let options = ParseOptions::new().read_cover_art(false);
    let probe = Probe::new(BufReader::new(open_regular(path)?)).options(options).guess_file_type()?;
    let file_type = probe.file_type().ok_or_else(|| TagError::Parse("unknown format".into()))?;
    let (tagged, mp4, wav): (TaggedFile, Option<Mp4Codec>, Option<WavFormat>) = match file_type {
        FileType::Mp4 => {
            let mut reader = probe.into_inner();
            reader.rewind()?;
            let file = Mp4File::read_from(&mut reader, options).map_err(parse_error)?;
            let codec = file.properties().codec();
            (file.into(), codec, None)
        }
        FileType::Wav => {
            let mut reader = probe.into_inner();
            reader.rewind()?;
            let file = WavFile::read_from(&mut reader, options).map_err(parse_error)?;
            let format = *file.properties().format();
            (file.into(), None, Some(format))
        }
        _ => (probe.read().map_err(parse_error)?, None, None),
    };
    let (codec, mime, lossless, unsupported) = format_of(file_type, mp4, wav);
    let properties = tagged.properties();
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let named = meta_from_name(path);
    let artists: Vec<String> = tag.map(|t| t.get_strings(ItemKey::TrackArtist).filter_map(clean).collect()).unwrap_or_default();
    Ok(LocalMeta {
        title: tag.and_then(|t| t.title()).and_then(|s| clean(&s)).unwrap_or(named.title),
        artists: if artists.is_empty() { named.artists } else { artists },
        album: tag.and_then(|t| t.album()).and_then(|s| clean(&s)),
        album_artist: tag.and_then(|t| t.get_string(ItemKey::AlbumArtist)).and_then(clean),
        track_no: tag.and_then(|t| t.track()),
        disc_no: tag.and_then(|t| t.disk()),
        year: tag.and_then(|t| t.date()).map(|date| date.year),
        genre: tag.and_then(|t| t.genre()).and_then(|s| clean(&s)),
        duration_ms: properties.duration().as_millis() as i64,
        codec,
        mime,
        bitrate_kbps: properties.audio_bitrate().or(properties.overall_bitrate()),
        sample_rate: properties.sample_rate(),
        bit_depth: properties.bit_depth(),
        lossless,
        unsupported,
    })
}

/// The front cover, else any embedded picture, else the folder's cover image.
pub fn read_cover(path: &Path) -> Result<Option<Vec<u8>>, TagError> {
    read_cover_from(open_regular(path)?, path.parent().unwrap_or(Path::new("")))
}

/// [`read_cover`] on a file the caller already opened and checked; `dir` is that file's folder.
pub fn read_cover_from(file: File, dir: &Path) -> Result<Option<Vec<u8>>, TagError> {
    cap_allocations(MAX_COVER_BYTES);
    let options = ParseOptions::new().read_properties(false).read_cover_art(true);
    let embedded = Probe::new(BufReader::new(file)).options(options).guess_file_type()?.read().ok().and_then(|tagged| {
        let pictures: Vec<_> = tagged.tags().iter().flat_map(|tag| tag.pictures()).collect();
        let pick = pictures.iter().find(|p| p.pic_type() == PictureType::CoverFront).or(pictures.first());
        pick.filter(|picture| picture.data().len() as u64 <= MAX_COVER_BYTES).map(|picture| picture.data().to_vec())
    });
    if embedded.is_some() {
        return Ok(embedded);
    }
    let Some(art) = folder_art(dir) else { return Ok(None) };
    let Ok(art) = open_inside(&art, dir) else { return Ok(None) };
    let mut bytes = Vec::new();
    art.take(MAX_COVER_BYTES + 1).read_to_end(&mut bytes)?;
    Ok((bytes.len() as u64 <= MAX_COVER_BYTES).then_some(bytes))
}

/// `local:` and 32 hex of the path's hash. Stored on first sight; a moved file keeps its old id.
pub fn local_id(path: &str) -> String {
    format!("local:{}", &sha256_hex(path.as_bytes())[..32])
}

/// `has_cover`: the cover route has a picture for this file. Without one the snapshot carries no
/// cover, so the renderer never asks.
pub fn snapshot(id: &str, meta: &LocalMeta, has_cover: bool) -> Value {
    let names = if meta.artists.is_empty() { vec!["Unknown Artist".to_string()] } else { meta.artists.clone() };
    let mut value = json!({
        "id": id,
        "title": meta.title,
        "artists": names.iter().map(|name| json!({"id": "", "name": name})).collect::<Vec<_>>(),
        "durationMs": meta.duration_ms,
        "local": {
            "albumArtist": meta.album_artist, "trackNo": meta.track_no, "discNo": meta.disc_no,
            "year": meta.year, "genre": meta.genre, "codec": meta.codec, "lossless": meta.lossless,
        },
    });
    if has_cover {
        value["cover"] = json!({"url": format!("{COVER_BASE}{id}/cover"), "width": 512, "height": 512});
    }
    if let Some(album) = &meta.album {
        value["album"] = json!({"id": "", "title": album});
    }
    value
}
