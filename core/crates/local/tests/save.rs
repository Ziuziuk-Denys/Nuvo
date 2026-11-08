mod common;

use nuvo_local::save::{SaveTags, extension_for, file_name, input_format, write_tags};
use nuvo_local::tags::read_meta;

#[test]
fn names_are_safe_on_any_disk() {
    assert_eq!(file_name("AC/DC", "Back: In *Black*?", "mp3"), "AC_DC - Back_ In _Black__.mp3");
    assert_eq!(file_name("", "..hidden..", "flac"), "hidden.flac");
    assert_eq!(file_name(" ", "\u{7}", "m4a"), "_.m4a");
    assert_eq!(file_name("", "", "opus"), "Track.opus");
    let long = file_name("Артист", &"я".repeat(200), "mp3");
    assert!(long.len() <= 124 && long.ends_with(".mp3"), "{long}");
}

#[test]
fn extensions_follow_the_cached_format() {
    assert_eq!(extension_for("audio/mpeg", None), "mp3");
    assert_eq!(extension_for("audio/mp4", Some("mp4a.40.2")), "m4a");
    assert_eq!(extension_for("audio/ogg; codecs=\"opus\"", Some("opus")), "opus");
    assert_eq!(extension_for("audio/ogg", Some("vorbis")), "ogg");
    assert_eq!(extension_for("audio/webm", Some("opus")), "webm");
    assert_eq!(extension_for("audio/flac", None), "flac");
    assert_eq!(extension_for("text/html", None), "bin");
}

#[test]
fn tags_round_trip_through_a_saved_copy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("copy.wav");
    common::write_wav(&path, 1);
    write_tags(&path, &SaveTags { title: "Song", artists: "Band", album: Some("LP"), cover: None }).unwrap();
    let meta = read_meta(&path).unwrap();
    assert_eq!((meta.title.as_str(), meta.artists.clone(), meta.album.as_deref()), ("Song", vec!["Band".to_string()], Some("LP")));
}

#[test]
fn names_never_escape_the_folder() {
    for hostile in ["..", "../..", "../../etc/passwd", "a/../b", "..\\..\\x", "/abs/path"] {
        let name = file_name(hostile, hostile, "mp3");
        assert!(!name.contains('/') && !name.contains('\\'), "{name}");
        assert!(!name.starts_with('.'), "{name}");
        assert!(name.ends_with(".mp3"));
    }
}

#[test]
fn cover_and_cyrillic_tags_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("copy.wav");
    common::write_wav(&path, 1);
    let cover = [0xFFu8, 0xD8, 0xFF, 0xE0, 1, 2, 3];
    write_tags(&path, &SaveTags { title: "Бессонница", artists: "Земфира", album: None, cover: Some((&cover, "image/jpeg")) }).unwrap();
    assert_eq!(nuvo_local::tags::read_cover(&path).unwrap(), Some(cover.to_vec()));
    assert_eq!(read_meta(&path).unwrap().title, "Бессонница");
}

#[test]
fn unreadable_copies_are_an_error_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("junk.mp3");
    std::fs::write(&path, b"garbage").unwrap();
    assert!(write_tags(&path, &SaveTags { title: "t", artists: "a", album: None, cover: None }).is_err());
    assert!(write_tags(&dir.path().join("missing.mp3"), &SaveTags { title: "t", artists: "a", album: None, cover: None }).is_err());
}

#[test]
fn album_survives_in_a_wav_copy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("copy.wav");
    common::write_wav(&path, 1);
    write_tags(&path, &SaveTags { title: "Song", artists: "Band", album: Some("LP"), cover: None }).unwrap();
    assert_eq!(read_meta(&path).unwrap().album.as_deref(), Some("LP"));
}

#[test]
fn a_hidden_part_file_takes_tags() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".nuvo-1.part");
    common::write_wav(&path, 1);
    write_tags(&path, &SaveTags { title: "Song", artists: "Band", album: Some("LP"), cover: None }).unwrap();
    assert_eq!(read_meta(&path).unwrap().album.as_deref(), Some("LP"));
}

#[test]
fn bidi_controls_cannot_disguise_a_name() {
    let name = file_name("Band\u{202E}", "\u{2066}gnp\u{200F}.exe\u{200E}", "mp3");
    assert!(!name.chars().any(|c| matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}')), "{name}");
    assert_eq!(name, "Band - gnp.exe.mp3");
}

#[test]
fn ffmpeg_is_told_the_input_format_it_should_expect() {
    assert_eq!(input_format("mp3"), Some("mp3"));
    assert_eq!(input_format("m4a"), Some("mov"));
    assert_eq!(input_format("webm"), Some("matroska"));
    assert_eq!(input_format("opus"), Some("ogg"));
    assert_eq!(input_format("bin"), None);
}
