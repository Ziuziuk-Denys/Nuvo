mod common;

use lofty::config::WriteOptions;
use lofty::file::FileType;
use lofty::iff::wav::WavFormat;
use lofty::mp4::Mp4Codec;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Tag, TagType};
use nuvo_local::tags::{format_of, local_id, meta_from_name, read_cover, read_meta, snapshot};

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
    assert_eq!((meta.title.as_str(), meta.unsupported), ("Broken", Some("unreadable")));
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

/// Whatever the bytes are, reading must return, never panic or hang.
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

/// A FIFO named like a song must not hang the scan: reads give up at once.
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
fn a_fifo_is_not_read_for_tags_or_covers() {
    let dir = tempfile::tempdir().unwrap();
    let fifo = dir.path().join("Band - Pipe.mp3");
    make_fifo(&fifo);
    let (meta_path, cover_path) = (fifo.clone(), fifo.clone());
    assert!(finishes_quickly(move || read_meta(&meta_path).is_err()).expect("read_meta hung on a FIFO"));
    assert!(finishes_quickly(move || read_cover(&cover_path).is_err()).expect("read_cover hung on a FIFO"));
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
