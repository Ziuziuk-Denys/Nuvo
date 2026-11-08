use nuvo_import::spotify::{EmbedError, Kind, PAGE_SIZE, SpotifyLink, page_query, parse_embed, parse_link, parse_page, song_count};
use serde_json::{Value, json};

const PLAYLIST: &str = include_str!("fixtures/spotify-embed-playlist.html");
const ALBUM: &str = include_str!("fixtures/spotify-embed-album.html");
const MISSING: &str = include_str!("fixtures/spotify-embed-missing.html");
const META: &str = include_str!("fixtures/spotify-playlist-meta.html");
const QUERY_PLAYLIST: &str = include_str!("fixtures/spotify-query-playlist.json");
const QUERY_ALBUM: &str = include_str!("fixtures/spotify-query-album.json");

#[test]
fn playlist_and_album_links_parse_in_every_form() {
    let playlist = SpotifyLink { kind: Kind::Playlist, id: "37i9dQZF1DWXRqgorJj26U".into() };
    for url in [
        "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U",
        "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U?si=abc123",
        "https://open.spotify.com/intl-de/playlist/37i9dQZF1DWXRqgorJj26U",
        "https://open.spotify.com/embed/playlist/37i9dQZF1DWXRqgorJj26U",
        " https://OPEN.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U/ ",
    ] {
        assert_eq!(parse_link(url), Some(playlist.clone()), "{url}");
    }
    let album = parse_link("https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv").unwrap();
    assert_eq!(album.kind, Kind::Album);
    assert_eq!(album.embed_url(), "https://open.spotify.com/embed/album/4LH4d3cOWNNsVw41Gqt2kv");
    assert_eq!(playlist.page_url(), "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U");
}

#[test]
fn other_links_are_refused() {
    for url in [
        "http://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U",
        "https://open.spotify.com/track/3zOYmiNOuyDL0ClxJcEJ0T",
        "https://open.spotify.com/collection/tracks",
        "https://open.spotify.com/playlist/short",
        "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U/extra",
        "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj2..",
        "https://evil.example/playlist/37i9dQZF1DWXRqgorJj26U",
        "https://open.spotify.com.evil.example/playlist/37i9dQZF1DWXRqgorJj26U",
        "https://spotify.link/abc",
    ] {
        assert_eq!(parse_link(url), None, "{url}");
    }
}

#[test]
fn a_playlist_embed_becomes_rows() {
    let listing = parse_embed(PLAYLIST, Kind::Playlist).unwrap();
    assert_eq!(listing.label, "Rock Classics");
    assert_eq!((listing.rows.len(), listing.listed), (4, 4));
    assert_eq!(listing.token.as_deref(), Some("redacted"));
    let first = &listing.rows[0];
    assert_eq!(first.title, "Dreams - 2004 Remaster");
    assert_eq!(first.artists, ["Fleetwood Mac"]);
    assert_eq!(first.duration_ms, Some(257_800));
    assert_eq!(first.album, None);
    assert_eq!(listing.rows[3].artists, ["Queen", "David Bowie"]);
}

#[test]
fn album_rows_carry_the_album_title() {
    let listing = parse_embed(ALBUM, Kind::Album).unwrap();
    assert_eq!(listing.label, "The Dark Side of the Moon");
    assert!(listing.rows.iter().all(|row| row.album.as_deref() == Some("The Dark Side of the Moon")));
    assert_eq!(listing.rows[0].artists, ["Pink Floyd"]);
}

#[test]
fn a_private_or_deleted_playlist_is_gone() {
    assert_eq!(parse_embed(MISSING, Kind::Playlist), Err(EmbedError::Gone));
}

#[test]
fn a_changed_page_is_reported() {
    assert_eq!(parse_embed("<html><body>new layout</body></html>", Kind::Playlist), Err(EmbedError::Changed));
    let broken = PLAYLIST.replace("\"trackList\"", "\"items\"");
    assert_eq!(parse_embed(&broken, Kind::Playlist), Err(EmbedError::Changed));
}

#[test]
fn the_public_page_names_the_song_count() {
    assert_eq!(song_count(META), Some(200));
    assert_eq!(song_count("<meta name=\"description\" content=\"x\"/>"), None);
}

#[test]
fn the_query_asks_for_the_next_page_the_way_the_web_player_does() {
    let playlist = parse_link("https://open.spotify.com/playlist/3Q1DIJ51dJpUO6RhnIHdVx").unwrap();
    let query = page_query(&playlist, 100);
    assert_eq!(query["operationName"], "fetchPlaylistContents");
    assert_eq!(query["variables"], json!({"uri": "spotify:playlist:3Q1DIJ51dJpUO6RhnIHdVx", "offset": 100, "limit": PAGE_SIZE}));
    assert_eq!(query["extensions"]["persistedQuery"]["sha256Hash"].as_str().map(str::len), Some(64));
    let album = parse_link("https://open.spotify.com/album/1YYOwsMjqmlG654m8t977S").unwrap();
    let query = page_query(&album, 200);
    assert_eq!(query["operationName"], "queryAlbumTracks");
    assert_eq!(query["variables"]["uri"], "spotify:album:1YYOwsMjqmlG654m8t977S");
    assert_eq!(query["variables"]["offset"], 200);
}

#[test]
fn a_playlist_page_becomes_rows_with_the_album_of_each_song() {
    let page = parse_page(QUERY_PLAYLIST.as_bytes(), Kind::Playlist, None).unwrap();
    assert_eq!((page.rows.len(), page.entries, page.total), (3, 3, 1012));
    let first = &page.rows[0];
    assert_eq!(first.title, "Only You");
    assert_eq!(first.artists, ["Yazoo"]);
    assert_eq!(first.album.as_deref(), Some("Upstairs at Eric's"));
    assert!(first.duration_ms.is_some_and(|ms| ms > 0));
    assert_eq!(page.rows[2].artists, ["Ed Sheeran"]);
}

#[test]
fn an_album_page_carries_the_album_title_given() {
    let page = parse_page(QUERY_ALBUM.as_bytes(), Kind::Album, Some("Haydn: Masses")).unwrap();
    assert_eq!((page.rows.len(), page.total), (3, 157));
    assert!(page.rows.iter().all(|row| row.album.as_deref() == Some("Haydn: Masses") && !row.artists.is_empty()));
    assert!(page.rows[0].title.starts_with("Mass No. 9"));
}

#[test]
fn episodes_and_missing_songs_count_as_entries_but_give_no_rows() {
    let mut data: Value = serde_json::from_str(QUERY_PLAYLIST).unwrap();
    data["data"]["playlistV2"]["content"]["items"][0]["itemV2"] = json!({"__typename": "EpisodeOrChapterResponseWrapper", "data": {"__typename": "Episode", "name": "A talk"}});
    data["data"]["playlistV2"]["content"]["items"][1]["itemV2"] = json!({"__typename": "NotFound"});
    let page = parse_page(data.to_string().as_bytes(), Kind::Playlist, None).unwrap();
    assert_eq!((page.rows.len(), page.entries), (1, 3));
}

#[test]
fn a_changed_or_refused_answer_is_reported() {
    for body in [
        "Invalid query hash",
        r#"{"error":{"status":401,"message":"Missing/invalid/expired access token"}}"#,
        r#"{"data":{"playlistV2":{"__typename":"NotFound","message":"Playlist not found"}}}"#,
        r#"{"errors":[{"message":"PersistedQueryNotFound"}]}"#,
    ] {
        assert_eq!(parse_page(body.as_bytes(), Kind::Playlist, None), Err(EmbedError::Changed), "{body}");
    }
    assert_eq!(parse_page(QUERY_PLAYLIST.as_bytes(), Kind::Album, None), Err(EmbedError::Changed));
}
