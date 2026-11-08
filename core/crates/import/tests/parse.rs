use nuvo_import::parse::{artist_list, csv_records, parse_file, parse_m3u, youtube_id};
use nuvo_import::{ParseError, SourceRow};
use serde_json::json;

#[test]
fn csv_records_follow_rfc_4180() {
    let text = "a,\"b, with comma\",\"say \"\"hi\"\"\"\r\n\"multi\nline\",x,\r\n\r\n";
    assert_eq!(csv_records(text).unwrap(), [vec!["a", "b, with comma", "say \"hi\""], vec!["multi\nline", "x", ""]]);
}

#[test]
fn csv_with_unterminated_quote_does_not_panic() {
    let text = "Track Name\n\"unterminated";
    let result = parse_file("x.csv", text.as_bytes());
    assert!(result.is_ok() || result.is_err());
}

#[test]
fn csv_with_bare_cr_line_ending() {
    let text = "Track Name\r1\r2\r";
    let records = csv_records(text).unwrap();
    assert_eq!(records.len(), 3);
}

#[test]
fn csv_with_cyrillic() {
    let csv = b"Track Name\n\xd0\x9f\xd0\xb5\xd1\x81\xd0\xbd\xd1\x8f\n";
    let parsed = parse_file("x.csv", csv).unwrap();
    assert_eq!(parsed[0].rows[0].title, "Песня");
}

#[test]
fn artists_with_commas_survive() {
    assert_eq!(artist_list("Tyler, The Creator, Kali Uchis"), ["Tyler, The Creator, Kali Uchis", "Tyler", "The Creator", "Kali Uchis"]);
    assert_eq!(artist_list(" Daft Punk "), ["Daft Punk"]);
    assert!(artist_list("  ").is_empty());
}

#[test]
fn exportify_csv_with_bom_crlf_reordered_and_unknown_columns() {
    let csv = "\u{feff}Added At,Artist Name(s),Track Name,Popularity,Duration (ms),Album Name,ISRC\r\n\
               2024-01-01,\"Tyler, The Creator, Kali Uchis\",\"See You Again\",80,180386,Flower Boy,USQX91700278\r\n\
               2024-01-02,Daft Punk,\"One More Time, Live\",70,320357.0,,\r\n\
               2024-01-03,Nobody,,1,1000,X,\r\n";
    let parsed = parse_file("/home/u/Downloads/My Playlist.csv", csv.as_bytes()).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!((parsed[0].source_kind, parsed[0].label.as_str(), parsed[0].liked), ("spotify-csv", "My Playlist", false));
    assert_eq!(parsed[0].rows.len(), 2, "a row without a title is skipped");
    assert_eq!(
        parsed[0].rows[0],
        SourceRow {
            title: "See You Again".into(),
            artists: vec!["Tyler, The Creator, Kali Uchis".into(), "Tyler".into(), "The Creator".into(), "Kali Uchis".into()],
            album: Some("Flower Boy".into()),
            duration_ms: Some(180386),
            isrc: Some("USQX91700278".into()),
            track: None,
            path: None,
        }
    );
    assert_eq!((parsed[0].rows[1].title.as_str(), parsed[0].rows[1].album.as_deref(), parsed[0].rows[1].duration_ms), ("One More Time, Live", None, Some(320357)));
    assert!(matches!(parse_file("x.csv", b"Artist,Album\nA,B\n"), Err(ParseError::Unreadable(_))));
}

#[test]
fn spotify_privacy_export_library_and_playlists() {
    let library = json!({"tracks": [{"artist": "Daft Punk", "album": "Discovery", "track": "Digital Love", "uri": "spotify:track:x"}, {"artist": "x"}]});
    let parsed = parse_file("YourLibrary.json", library.to_string().as_bytes()).unwrap();
    assert_eq!((parsed[0].source_kind, parsed[0].label.as_str(), parsed[0].liked), ("spotify-library", "Liked songs", true));
    assert_eq!(parsed[0].rows, [SourceRow { title: "Digital Love".into(), artists: vec!["Daft Punk".into()], album: Some("Discovery".into()), ..Default::default() }]);

    let playlists = json!({"playlists": [
        {"name": "Road", "items": [{"track": {"trackName": "Song", "artistName": "Artist", "albumName": "LP", "trackUri": "spotify:track:y"}}, {"episode": {"episodeName": "Pod"}, "track": null}]},
        {"name": "Empty", "items": []}
    ]});
    let parsed = parse_file("Playlist1.json", playlists.to_string().as_bytes()).unwrap();
    assert_eq!(parsed.iter().map(|p| (p.label.as_str(), p.rows.len())).collect::<Vec<_>>(), [("Road", 1), ("Empty", 0)]);
    assert_eq!(parsed[0].rows[0].duration_ms, None, "the privacy export has no lengths");
    assert!(matches!(parse_file("other.json", b"{\"hello\": 1}"), Err(ParseError::Unreadable(_))));
}

#[test]
fn m3u_with_extinf_urls_local_paths_and_garbage() {
    let text = "#EXTM3U\n#EXTINF:215,Daft Punk - One More Time\nhttps://music.youtube.com/watch?v=FGBhQbmPwH8&list=x\n\
                #EXTINF:180 tvg-id=\"x\",Burial - Archangel\nhttps://soundcloud.com/burial/archangel\n\
                /home/u/Music/Massive Attack - Teardrop.flac\n#EXTVLCOPT:network-caching=1000\nnot a location\n\
                #EXTINF:-1,\nhttps://example.com/stream\nhttps://youtu.be/dQw4w9WgXcQ\n";
    let parsed = parse_m3u("Mix", text).unwrap();
    let rows: Vec<(String, Vec<String>, Option<i64>, bool)> = parsed.rows.iter().map(|r| (r.title.clone(), r.artists.clone(), r.duration_ms, r.track.is_some())).collect();
    assert_eq!(
        rows,
        [
            ("One More Time".to_string(), vec!["Daft Punk".to_string()], Some(215_000), true),
            ("Archangel".to_string(), vec!["Burial".to_string()], Some(180_000), false),
            ("Teardrop".to_string(), vec!["Massive Attack".to_string()], None, false),
            ("dQw4w9WgXcQ".to_string(), vec![], None, true),
        ]
    );
    assert_eq!(parsed.rows[0].track.as_ref().unwrap()["id"], "FGBhQbmPwH8");
}

#[test]
fn m3u_bare_youtube_url_uses_video_id_as_title() {
    let text = "#EXTM3U\nhttps://youtu.be/dQw4w9WgXcQ\n";
    let parsed = parse_m3u("urls", text).unwrap();
    assert_eq!(parsed.rows.len(), 1);
    assert_eq!(parsed.rows[0].title, "dQw4w9WgXcQ");
    assert!(parsed.rows[0].track.is_some());
}

#[test]
fn nuvo_json_requires_version_1() {
    let doc = json!({"format": "nuvo-playlist", "version": 2, "title": "Bad", "tracks": []});
    assert!(matches!(parse_file("x.json", doc.to_string().as_bytes()), Err(ParseError::Unreadable(_))));
}

#[test]
fn youtube_ids_from_every_link_shape() {
    assert_eq!(youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
    assert_eq!(youtube_id("https://youtu.be/dQw4w9WgXcQ?t=3").as_deref(), Some("dQw4w9WgXcQ"));
    assert_eq!(youtube_id("https://music.youtube.com/watch?list=x&v=dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
    assert_eq!(youtube_id("https://youtube.com/shorts/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
    for bad in ["https://evil.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/short", "ftp://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXc!"] {
        assert_eq!(youtube_id(bad), None, "{bad}");
    }
}

#[test]
fn nuvo_json_round_trip() {
    let track = json!({"id": "dQw4w9WgXcQ", "title": "Never", "artists": [{"id": "a", "name": "Rick"}], "album": {"id": "al", "title": "Whenever"}, "durationMs": 213000.4});
    let doc = json!({"format": "nuvo-playlist", "version": 1, "title": "Mine", "tracks": [track, {"title": "no id"}]});
    let parsed = parse_file("mine.json", doc.to_string().as_bytes()).unwrap();
    assert_eq!((parsed[0].source_kind, parsed[0].label.as_str()), ("nuvo-json", "Mine"));
    assert_eq!(parsed[0].rows.len(), 1);
    let row = &parsed[0].rows[0];
    assert_eq!((row.title.as_str(), row.artists.as_slice(), row.album.as_deref(), row.duration_ms), ("Never", ["Rick".to_string()].as_slice(), Some("Whenever"), Some(213000)));
    assert_eq!(row.track.as_ref().and_then(|t| t.get("title")), Some(&json!("Never")));
}

#[test]
fn size_row_and_type_caps() {
    let big = vec![b'a'; nuvo_import::MAX_FILE_BYTES as usize + 1];
    assert_eq!(parse_file("x.csv", &big), Err(ParseError::TooLarge));
    let mut csv = String::from("Track Name\n");
    for i in 0..=nuvo_import::MAX_ROWS {
        csv.push_str(&format!("t{i}\n"));
    }
    assert_eq!(parse_file("x.csv", csv.as_bytes()), Err(ParseError::TooManyRows));
    assert!(matches!(parse_file("x.txt", b"hi"), Err(ParseError::Unreadable(_))));
}

#[test]
fn empty_csv_is_unreadable() {
    assert!(matches!(parse_file("x.csv", b""), Err(ParseError::Unreadable(_))));
}

#[test]
fn huge_duration_and_non_finite_values_rejected() {
    let csv = "Track Name,Duration (ms)\n\
               Big,9999999999999999999\n\
               Infinity,inf\n\
               NaN,nan\n";
    let parsed = parse_file("x.csv", csv.as_bytes()).unwrap();
    assert_eq!(parsed[0].rows.len(), 3, "rows kept but durations rejected");
    assert!(parsed[0].rows.iter().all(|r| r.duration_ms.is_none()), "all durations should be None");
}
