use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use lofty::config::{GlobalOptions, ParseOptions, apply_global_options};
use lofty::error::{AllocationError, TooMuchDataError};
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

pub const COVER_BASE: &str = "nuvo-core://local/v1/local/tracks/";
const MAX_TEXT_CHARS: usize = 512;
const MAX_COVER_BYTES: u64 = 8 * 1024 * 1024;
/// A picture over this size is known to exist from its header alone, so the probe never reads it.
const PICTURE_PROBE_BYTES: u64 = 1024 * 1024;
/// Tag reading skips pictures, so the limit only guards text, lyrics and other frames.
pub(crate) const MAX_TAG_ITEM_BYTES: u64 = 32 * 1024 * 1024;

// Lofty's allocation limit is per thread: set it on every entry so hostile items fail early
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

// "02 - ", "02.", "1)" or a zero-led "02 " is a track number; "50 Cent" and "1979" are names
fn without_track_number(stem: &str) -> &str {
    let digits = stem.len() - stem.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if digits == 0 || digits > 3 {
        return stem;
    }
    let after = &stem[digits..];
    let named = if let Some(rest) = after.trim_start().strip_prefix(['.', '-', ')', '_']) {
        rest.trim_start()
    } else if after.starts_with(' ') && digits > 1 && stem.starts_with('0') {
        after.trim_start()
    } else {
        return stem;
    };
    if named.is_empty() { stem } else { named }
}

fn mime_from_extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        _ => return None,
    })
}

// Tags that fail to parse say nothing about the audio, which the player may still decode
pub fn meta_from_name(path: &Path) -> LocalMeta {
    let stem = without_track_number(path.file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown"));
    let mime = mime_from_extension(path);
    let (artists, title) = match stem.split_once(" - ") {
        Some((artist, title)) if !artist.trim().is_empty() && !title.trim().is_empty() => (clean(artist).into_iter().collect(), clean(title)),
        _ => (Vec::new(), clean(stem)),
    };
    LocalMeta {
        title: title.unwrap_or_else(|| "Unknown".into()),
        artists,
        codec: "unknown",
        mime: mime.unwrap_or("application/octet-stream"),
        unsupported: mime.is_none().then_some("unreadable"),
        ..LocalMeta::default()
    }
}

// Content decides; the extension names a file whose tag is followed by junk before the first frame
fn probe(path: &Path, options: ParseOptions) -> Result<Probe<BufReader<File>>, TagError> {
    let probe = Probe::new(BufReader::new(open_regular(path)?)).options(options).guess_file_type()?;
    Ok(match (probe.file_type(), FileType::from_path(path)) {
        (None, Some(named)) => probe.set_file_type(named),
        _ => probe,
    })
}

pub fn read_meta(path: &Path) -> Result<LocalMeta, TagError> {
    cap_allocations(MAX_TAG_ITEM_BYTES);
    let options = ParseOptions::new().read_cover_art(false);
    let probe = probe(path, options)?;
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
    let album_artist = tag.and_then(|t| t.get_string(ItemKey::AlbumArtist)).and_then(clean);
    Ok(LocalMeta {
        title: tag.and_then(|t| t.title()).and_then(|s| clean(&s)).unwrap_or(named.title),
        artists: match (artists.is_empty(), &album_artist) {
            (false, _) => artists,
            (true, Some(album_artist)) => vec![album_artist.clone()],
            (true, None) => named.artists,
        },
        album: tag.and_then(|t| t.album()).and_then(|s| clean(&s)),
        album_artist,
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

// shortcut: any other item over the probe size also reads as a picture; the cover route then answers 404
pub fn has_picture(path: &Path) -> bool {
    cap_allocations(PICTURE_PROBE_BYTES);
    let options = ParseOptions::new().read_properties(false).read_cover_art(true);
    let Ok(probe) = probe(path, options) else { return false };
    match probe.read() {
        Ok(tagged) => tagged.tags().iter().any(|tag| !tag.pictures().is_empty()),
        Err(err) => over_limit(&err),
    }
}

fn over_limit(err: &(dyn std::error::Error + 'static)) -> bool {
    let mut cause = Some(err);
    while let Some(err) = cause {
        if err.is::<AllocationError>() || err.is::<TooMuchDataError>() {
            return true;
        }
        cause = err.source();
    }
    false
}

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

// Stored on first sight, so a moved file keeps its old id
pub fn local_id(path: &str) -> String {
    format!("local:{}", &sha256_hex(path.as_bytes())[..32])
}

// Without a cover the snapshot carries none, so the renderer never asks the route
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
