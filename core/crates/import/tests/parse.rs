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
    assert!(matches!(parse_file("x.pdf", b"hi"), Err(ParseError::Unreadable(_))));
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

fn fixture(name: &str) -> Vec<nuvo_import::Parsed> {
    let bytes = std::fs::read(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap();
    parse_file(name, &bytes).unwrap()
}

type Brief = (String, Vec<String>, Option<String>, Option<i64>);

fn brief(parsed: &nuvo_import::Parsed) -> Vec<Brief> {
    parsed.rows.iter().map(|r| (r.title.clone(), r.artists.clone(), r.album.clone(), r.duration_ms)).collect()
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn soundiiz_csv_reads_durations_in_seconds() {
    let parsed = fixture("soundiiz.csv");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].label, "soundiiz");
    assert_eq!(
        brief(&parsed[0])[..2],
        [
            ("Где нас нет".to_string(), strings(&["Oxxxymiron"]), Some("Горгород".to_string()), Some(215_000)),
            ("Unholy (feat. Kim Petras)".to_string(), strings(&["Sam Smith, Kim Petras", "Sam Smith", "Kim Petras"]), Some("Unholy (feat. Kim Petras)".to_string()), Some(157_000)),
        ]
    );
    assert_eq!(parsed[0].rows[0].isrc.as_deref(), Some("RUA101500123"));
    assert_eq!(parsed[0].rows[2].album.as_deref(), Some("I Ain’t Worried (Music From The Motion Picture \"Top Gun: Maverick\")"));
}

#[test]
fn tunemymusic_csv_keeps_artists_and_splits_playlists() {
    let parsed = fixture("tunemymusic.csv");
    assert_eq!(parsed.iter().map(|p| (p.label.as_str(), p.rows.len())).collect::<Vec<_>>(), [("Русский рок", 2), ("Anime", 1)]);
    assert_eq!(brief(&parsed[0])[0], ("Группа крови".to_string(), strings(&["Кино"]), Some("Группа крови".to_string()), None));
    assert_eq!(parsed[1].rows[0].artists, ["MYTH & ROID"]);
    assert_eq!(parsed[0].rows[0].isrc.as_deref(), Some("RUA108700001"));
}

#[test]
fn takeout_library_songs_are_playable_tracks() {
    let parsed = fixture("music library songs.csv");
    assert_eq!(parsed[0].label, "music library songs");
    assert_eq!(parsed[0].rows.len(), 3);
    let row = &parsed[0].rows[2];
    assert_eq!((row.title.as_str(), row.artists.as_slice(), row.album.as_deref()), ("Feel Good Inc.", strings(&["Gorillaz", "De La Soul"]).as_slice(), Some("Demon Days")));
    let track = row.track.as_ref().unwrap();
    assert_eq!((track["id"].as_str(), track["title"].as_str()), (Some("AbCdEfGhIjK"), Some("Feel Good Inc.")));
    assert_eq!(track["artists"], json!([{"id": "", "name": "Gorillaz"}, {"id": "", "name": "De La Soul"}]));
    assert_eq!(track["album"], json!({"id": "", "title": "Demon Days"}));
}

#[test]
fn takeout_playlist_keeps_video_ids() {
    let parsed = fixture("Road trip-videos.csv");
    assert_eq!(parsed[0].label, "Road trip");
    let ids: Vec<&str> = parsed[0].rows.iter().map(|r| r.track.as_ref().unwrap()["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["9bZkp7q19f0", "kJQP7kiw5Fk"]);
}

#[test]
fn csv_without_title_or_video_ids_is_refused() {
    assert!(matches!(parse_file("x.csv", b"Artist,Album\nA,B\n"), Err(ParseError::Unreadable(_))));
    assert!(matches!(parse_file("x.csv", b"Video ID,Time\n"), Err(ParseError::Unreadable(_))));
}

#[test]
fn soundiiz_xspf_with_seconds() {
    let parsed = fixture("soundiiz.xspf");
    assert_eq!(parsed[0].label, "Zvuk & Friends");
    assert_eq!(
        brief(&parsed[0]),
        [
            ("Pink Venom".to_string(), strings(&["BLACKPINK"]), Some("Pink Venom".to_string()), Some(187_000)),
            ("Розовое вино".to_string(), strings(&["Элджей, Feduk", "Элджей", "Feduk"]), Some("Sayonara детка".to_string()), Some(205_000)),
        ]
    );
    assert_eq!(parsed[0].rows[0].isrc.as_deref(), Some("KRA402200017"));
}

#[test]
fn spec_xspf_with_milliseconds_entities_and_links() {
    let parsed = fixture("spec.xspf");
    assert_eq!(parsed[0].label, "Road <Trip>");
    assert_eq!(
        brief(&parsed[0]),
        [
            ("One More Time".to_string(), strings(&["Daft Punk"]), None, Some(320_357)),
            ("Teardrop & Co".to_string(), strings(&["Massive Attack"]), Some("Mezzanine".to_string()), Some(330_000)),
            ("Rock & Roll – Live".to_string(), strings(&["Led Zeppelin"]), None, None),
        ]
    );
    assert_eq!(parsed[0].rows[0].track.as_ref().unwrap()["id"], "FGBhQbmPwH8");
    assert_eq!(parsed[0].rows[1].path.as_deref(), Some("/home/u/My Music/teardrop.flac"));
    assert!(matches!(parse_file("x.xspf", b"<playlist><trackList><track><title>a"), Err(ParseError::Unreadable(_))));
}

#[test]
fn text_lists_artist_dash_title() {
    let parsed = fixture("soundiiz.txt");
    assert_eq!(
        brief(&parsed[0]),
        [
            ("Nobody Gets Me".to_string(), strings(&["SZA"]), None, None),
            ("Unholy (feat. Kim Petras)".to_string(), strings(&["Sam Smith, Kim Petras", "Sam Smith", "Kim Petras"]), None, None),
            ("Группа крови".to_string(), strings(&["Кино"]), None, None),
            ("dQw4w9WgXcQ".to_string(), vec![], None, None),
            ("Just a title".to_string(), vec![], None, None),
        ]
    );
    assert_eq!(parsed[0].rows[3].track.as_ref().unwrap()["id"], "dQw4w9WgXcQ");
}

#[test]
fn soundiiz_json_list() {
    let parsed = fixture("soundiiz.json");
    assert_eq!(parsed[0].label, "soundiiz");
    assert_eq!(brief(&parsed[0]), [("Harder, Better, Faster, Stronger".to_string(), strings(&["Daft Punk"]), Some("Discovery".to_string()), Some(224_000))]);
    assert_eq!(parsed[0].rows[0].isrc.as_deref(), Some("GBDUW0000059"));
}
