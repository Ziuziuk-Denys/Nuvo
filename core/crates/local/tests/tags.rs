mod common;

use lofty::config::WriteOptions;
use lofty::file::FileType;
use lofty::iff::wav::WavFormat;
use lofty::mp4::Mp4Codec;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Tag, TagType};
use common::read_cover;
use nuvo_local::tags::{format_of, has_picture, local_id, meta_from_name, read_meta, snapshot};

#[test]
fn untagged_wav_is_named_from_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("Artist Name - Song Title.wav");
    common::write_wav(&path, 2);
    let meta = read_meta(&path).unwrap();
    assert_eq!(meta.title, "Song Title");
    assert_eq!(meta.artists, ["Artist Name"]);
    assert_eq!((meta.codec, meta.mime, meta.lossless, meta.unsupported), ("pcm", "audio/wav", true, None));
    assert!((1900..=2100).contains(&meta.duration_ms), "{}", meta.duration_ms);
    assert_eq!((meta.sample_rate, meta.bit_depth), (Some(8000), Some(16)));
}

#[test]
fn tags_win_over_the_file_name() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("x.wav");
    common::write_wav(&path, 1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title("Tagged".into());
    tag.set_artist("Band".into());
    tag.set_album("Record".into());
    tag.set_track(3);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let meta = read_meta(&path).unwrap();
    assert_eq!((meta.title.as_str(), meta.artists.clone(), meta.album.as_deref(), meta.track_no), ("Tagged", vec!["Band".to_string()], Some("Record"), Some(3)));
}

#[test]
fn a_picture_is_found_without_loading_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.wav");
    common::write_wav(&path, 1);
    assert!(!has_picture(&path));
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title("Plain".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert!(!has_picture(&path));
    tag.push_picture(Picture::unchecked(vec![1, 2, 3]).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert!(has_picture(&path));
    tag.remove_picture(0);
    tag.push_picture(Picture::unchecked(vec![5; 6 * 1024 * 1024]).pic_type(PictureType::Other).mime_type(MimeType::Png).build());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert!(has_picture(&path), "a picture too big to load still counts");
    std::fs::write(&path, b"not audio").unwrap();
    assert!(!has_picture(&path));
}

fn flac_bytes(picture: Option<usize>) -> Vec<u8> {
    let mut bytes = b"fLaC".to_vec();
    bytes.extend([if picture.is_some() { 0 } else { 0x80 }, 0, 0, 34]);
    bytes.extend([0x10, 0, 0x10, 0, 0, 0, 0, 0, 0, 0]);
    bytes.extend(((44_100u64 << 44) | (1 << 41) | (15 << 36)).to_be_bytes());
    bytes.extend([0; 16]);
    if let Some(len) = picture {
        let mut block = Vec::new();
        block.extend(3u32.to_be_bytes());
        block.extend(9u32.to_be_bytes());
        block.extend(b"image/png");
        block.extend([0; 4 + 16]);
        block.extend((len as u32).to_be_bytes());
        block.extend(vec![7; len]);
        bytes.push(0x86);
        bytes.extend(&(block.len() as u32).to_be_bytes()[1..]);
        bytes.extend(block);
    }
    bytes
}

#[test]
fn flac_pictures_are_found_small_or_big() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.flac");
    std::fs::write(&path, flac_bytes(None)).unwrap();
    assert!(!has_picture(&path));
    std::fs::write(&path, flac_bytes(Some(64))).unwrap();
    assert!(has_picture(&path));
    std::fs::write(&path, flac_bytes(Some(5 * 1024 * 1024))).unwrap();
    assert!(has_picture(&path));
}

fn mp3_bytes(junk_after_tag: usize) -> Vec<u8> {
    let mut frame = b"TIT2".to_vec();
    frame.extend(4u32.to_be_bytes());
    frame.extend([0, 0, 0]);
    frame.extend(b"Mix");
    let mut bytes = b"ID3\x03\x00\x00".to_vec();
    bytes.extend([0, 0, 0, frame.len() as u8]);
    bytes.extend(frame);
    bytes.extend(vec![0; junk_after_tag]);
    for _ in 0..40 {
        bytes.extend([0xFF, 0xFB, 0x90, 0x64]);
        bytes.extend([0; 413]);
    }
    bytes
}

#[test]
fn junk_between_the_tag_and_the_audio_still_reads() {
    let dir = tempfile::tempdir().unwrap();
    for junk in [0, 1044] {
        let path = dir.path().join(format!("00 Mix {junk}.mp3"));
        std::fs::write(&path, mp3_bytes(junk)).unwrap();
        let meta = read_meta(&path).unwrap_or_else(|err| panic!("{junk} bytes of junk: {err}"));
        assert_eq!((meta.title.as_str(), meta.codec, meta.unsupported), ("Mix", "mp3", None));
        assert!(meta.duration_ms > 900, "{}", meta.duration_ms);
    }
}

#[test]
fn formats_say_what_plays() {
    assert_eq!(format_of(FileType::Mpeg, None, None), ("mp3", "audio/mpeg", false, None));
    assert_eq!(format_of(FileType::Flac, None, None), ("flac", "audio/flac", true, None));
    assert_eq!(format_of(FileType::Opus, None, None), ("opus", "audio/ogg", false, None));
    assert_eq!(format_of(FileType::Vorbis, None, None), ("vorbis", "audio/ogg", false, None));
    assert_eq!(format_of(FileType::Mp4, Some(Mp4Codec::AAC), None), ("aac", "audio/mp4", false, None));
    assert_eq!(format_of(FileType::Mp4, Some(Mp4Codec::ALAC), None), ("alac", "audio/mp4", true, Some("alac")));
    assert_eq!(format_of(FileType::Wav, None, Some(WavFormat::Other(2))).3, Some("wav_codec"));
}

#[test]
fn garbage_is_unreadable_but_named() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("Band - Broken.mp3");
    std::fs::write(&path, b"not audio at all").unwrap();
    assert!(read_meta(&path).is_err());
    let meta = meta_from_name(&path);
    assert_eq!((meta.title.as_str(), meta.codec, meta.mime, meta.unsupported), ("Broken", "unknown", "audio/mpeg", None), "the player may still decode it");
}

#[test]
fn a_leading_track_number_is_not_the_artist() {
    let named = |name: &str| {
        let meta = meta_from_name(std::path::Path::new(name));
        (meta.artists, meta.title)
    };
    let artist = |a: &str| vec![a.to_string()];
    assert_eq!(named("02 - Luna.flac"), (vec![], "Luna".into()));
    assert_eq!(named("02 Vandal - Long Road.flac"), (artist("Vandal"), "Long Road".into()));
    assert_eq!(named("02.Frozen - Into the light.ogg"), (artist("Frozen"), "Into the light".into()));
    assert_eq!(named("02. Nebelgrab - Wanderer.flac"), (artist("Nebelgrab"), "Wanderer".into()));
    assert_eq!(named("1. Song.mp3"), (vec![], "Song".into()));
    assert_eq!(named("50 Cent - In Da Club.mp3"), (artist("50 Cent"), "In Da Club".into()));
    assert_eq!(named("10 Years - Wasteland.mp3"), (artist("10 Years"), "Wasteland".into()));
    assert_eq!(named("1979.mp3"), (vec![], "1979".into()));
}

#[test]
fn the_album_artist_stands_in_for_a_missing_track_artist() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("02 - Luna.wav");
    common::write_wav(&path, 1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title("Luna".into());
    tag.insert_text(ItemKey::AlbumArtist, "Band".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert_eq!(read_meta(&path).unwrap().artists, ["Band"]);
}

#[test]
fn ids_and_snapshots() {
    let id = local_id("/music/a.flac");
    assert_eq!(id.len(), 38);
    assert!(id.starts_with("local:") && id[6..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
    assert_eq!(id, local_id("/music/a.flac"));
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("A - B.wav");
    common::write_wav(&path, 1);
    let snap = snapshot(&id, &read_meta(&path).unwrap(), true);
    assert_eq!(snap["id"], id.as_str());
    assert_eq!(snap["artists"][0]["name"], "A");
    assert_eq!(snap["cover"]["url"], format!("nuvo-core://local/v1/local/tracks/{id}/cover"));
    assert_eq!(snap["local"]["codec"], "pcm");
    assert!(snap.get("album").is_none());
    assert!(snapshot(&id, &read_meta(&path).unwrap(), false).get("cover").is_none(), "a file without a picture has nothing to request");
}

#[test]
fn covers_come_embedded_first_then_from_the_folder() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.wav");
    common::write_wav(&path, 1);
    assert_eq!(read_cover(&path).unwrap(), None);
    std::fs::write(dir.path().join("cover.jpg"), b"folder").unwrap();
    assert_eq!(read_cover(&path).unwrap().as_deref(), Some(&b"folder"[..]));
    let mut tag = Tag::new(TagType::Id3v2);
    tag.push_picture(Picture::unchecked(vec![1, 2, 3]).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert_eq!(read_cover(&path).unwrap(), Some(vec![1, 2, 3]));
}

fn tagged_wav_bytes() -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.wav");
    common::write_wav(&path, 1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title("Заголовок".into());
    tag.set_artist("Артист".into());
    tag.push_picture(Picture::unchecked(vec![7; 64]).pic_type(PictureType::CoverFront).mime_type(MimeType::Jpeg).build());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    std::fs::read(path).unwrap()
}

#[test]
fn truncated_and_garbage_files_never_panic() {
    let dir = tempfile::tempdir().unwrap();
    let good = tagged_wav_bytes();
    let mut seed = 0x2545_F491_4F6C_DD1Du64;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for ext in ["wav", "mp3", "flac", "m4a", "ogg", "opus", "aac"] {
        let path = dir.path().join(format!("fuzz.{ext}"));
        let mut cases: Vec<Vec<u8>> = (0..good.len().min(400)).step_by(7).map(|n| good[..n].to_vec()).collect();
        cases.push(Vec::new());
        cases.push(b"ID3\x04\x00\x00\x7f\x7f\x7f\x7fTIT2\xff\xff\xff\xff".to_vec());
        cases.push(b"fLaC\x00\xff\xff\xff".to_vec());
        cases.push(b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00OpusHead".to_vec());
        cases.push(b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00\xff\xff\xff\xffmoov".to_vec());
        for _ in 0..20 {
            let len = (next() % 600) as usize;
            cases.push((0..len).map(|_| next() as u8).collect());
        }
        for _ in 0..30 {
            let mut flipped = good.clone();
            for _ in 0..4 {
                let at = (next() as usize) % flipped.len().min(200);
                flipped[at] = next() as u8;
            }
            cases.push(flipped);
        }
        for bytes in cases {
            std::fs::write(&path, &bytes).unwrap();
            let _ = read_meta(&path);
            let _ = read_cover(&path);
        }
    }
}

#[test]
fn text_is_cleaned_and_capped() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("x.wav");
    common::write_wav(&path, 1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title(format!("  A\u{7}B\n{}  ", "я".repeat(2000)));
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let title = read_meta(&path).unwrap().title;
    assert!(title.starts_with("AB"), "{title}");
    assert_eq!(title.chars().count(), 512);
    assert!(!title.chars().any(char::is_control));
}

#[test]
fn oversized_covers_are_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.wav");
    common::write_wav(&path, 1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.push_picture(Picture::unchecked(vec![9; 21 * 1024 * 1024]).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert_eq!(read_cover(&path).unwrap(), None);
    let big = dir.path().join("cover.jpg");
    std::fs::File::create(&big).unwrap().set_len(21 * 1024 * 1024).unwrap();
    assert_eq!(read_cover(&path).unwrap(), None, "a folder image over the cap is ignored too");
}

#[test]
fn cyrillic_paths_read_and_name_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("Земфира - Бессонница.wav");
    common::write_wav(&path, 1);
    let meta = read_meta(&path).unwrap();
    assert_eq!((meta.title.as_str(), meta.artists.clone()), ("Бессонница", vec!["Земфира".to_string()]));
}

#[cfg(unix)]
fn make_fifo(path: &std::path::Path) {
    assert!(std::process::Command::new("mkfifo").arg(path).status().unwrap().success());
}

#[cfg(unix)]
fn finishes_quickly<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(work());
    });
    rx.recv_timeout(std::time::Duration::from_secs(3)).ok()
}

#[test]
#[cfg(unix)]
fn a_fifo_is_not_read_for_tags_or_pictures() {
    let dir = tempfile::tempdir().unwrap();
    let fifo = dir.path().join("Band - Pipe.mp3");
    make_fifo(&fifo);
    let (meta_path, cover_path) = (fifo.clone(), fifo.clone());
    assert!(finishes_quickly(move || read_meta(&meta_path).is_err()).expect("read_meta hung on a FIFO"));
    assert!(!finishes_quickly(move || has_picture(&cover_path)).expect("has_picture hung on a FIFO"));
}

#[test]
#[cfg(unix)]
fn a_linked_audio_file_is_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let real = dir.path().join("real.wav");
    common::write_wav(&real, 1);
    let link = dir.path().join("link.wav");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(read_meta(&link).is_err());
    assert!(read_meta(&real).is_ok());
}
