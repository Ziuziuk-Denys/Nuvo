use nuvo_import::export::{ExportPlaylist, ExportTrack, csv, csv_cell, m3u8, nuvo_library, nuvo_playlist, public_url};
use nuvo_import::parse_file;
use serde_json::{Value, json};

fn snap(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "", "name": artist}], "durationMs": ms, "viewer": {"liked": true}})
}

fn mix() -> ExportPlaylist {
    ExportPlaylist {
        title: "Mix\nTwo".into(),
        description: Some("d".into()),
        tracks: vec![
            ExportTrack { snapshot: snap("dQw4w9WgXcQ", "Song", "Rick", 213_000), local_path: None, added_at: Some(1) },
            ExportTrack { snapshot: snap("local:0123456789abcdef0123456789abcdef", "Mine", "Me", 61_400), local_path: Some("/home/u/Music/Me - Mine.flac".into()), added_at: Some(2) },
            ExportTrack { snapshot: json!({"id": "sc:1", "title": "Cloud", "artists": [{"id": "", "name": "S"}], "durationMs": 0, "permalinkUrl": "https://soundcloud.com/s/cloud"}), local_path: None, added_at: None },
        ],
    }
}

#[test]
fn m3u8_names_local_files_by_path_and_streams_by_link() {
    let text = m3u8(&mix());
    assert_eq!(text, "#EXTM3U\n#PLAYLIST:Mix Two\n#EXTINF:213,Rick - Song\nhttps://music.youtube.com/watch?v=dQw4w9WgXcQ\n#EXTINF:61,Me - Mine\n/home/u/Music/Me - Mine.flac\n#EXTINF:-1,S - Cloud\nhttps://soundcloud.com/s/cloud\n");
    let back = parse_file("Mix.m3u8", text.as_bytes()).unwrap();
    assert_eq!(back[0].rows.len(), 3);
    assert_eq!(back[0].rows[0].track.as_ref().unwrap()["id"], "dQw4w9WgXcQ");
    assert_eq!(back[0].rows[1].path.as_deref(), Some("/home/u/Music/Me - Mine.flac"));
}

#[test]
fn csv_is_exportify_shaped_safe_and_imports_back() {
    let mix = mix();
    let rows: Vec<(Option<&str>, &ExportTrack)> = mix.tracks.iter().map(|t| (Some("Mix"), t)).collect();
    let text = csv(&rows);
    assert!(text.starts_with("Track Name,Artist Name(s),Album Name,Duration (ms),Added At,Playlist,Source,Nuvo ID,URL\r\n"));
    assert!(!text.contains("/home/u"), "CSV never carries local paths");
    assert_eq!(csv_cell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert_eq!(csv_cell("\t=1+1"), "'\t=1+1");
    assert_eq!(csv_cell("\r=1+1"), "\"'\r=1+1\"");
    assert_eq!(csv_cell("a,\"b\""), "\"a,\"\"b\"\"\"");
    let back = parse_file("Mix.csv", text.as_bytes()).unwrap();
    assert_eq!(back[0].rows.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), ["Song", "Mine", "Cloud"]);
}

#[test]
fn nuvo_json_round_trips_and_drops_viewer_state() {
    let doc = nuvo_playlist(&mix());
    assert!(doc["tracks"][0].get("viewer").is_none());
    assert!(!doc.to_string().contains("/home/u"));
    let back = parse_file("Mix.json", doc.to_string().as_bytes()).unwrap();
    assert_eq!(back[0].rows.len(), 3);
    let library = nuvo_library(&mix().tracks[..1], &[mix()], 5);
    let back = parse_file("library.json", library.to_string().as_bytes()).unwrap();
    assert_eq!(back.len(), 2);
    assert!(back[0].liked && back[0].rows.len() == 1);
    assert_eq!(back[1].label, "Mix\nTwo");
}

#[test]
fn public_urls() {
    assert_eq!(public_url(&json!({"id": "local:0123456789abcdef0123456789abcdef"})), None);
    assert_eq!(public_url(&json!({"id": "sc:9", "permalinkUrl": "http://evil"})), None);
}
