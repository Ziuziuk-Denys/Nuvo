//! Writes one JSON fixture per response type into `fixtures/`. The vitest suite
//! (`src/shared/contracts/coreFixtures.test.ts`) checks them against the TypeScript contracts.

use nuvo_contracts::*;
use serde::Serialize;
use serde_json::{Value, json};

fn track() -> Value {
    json!({"id": "dQw4w9WgXcQ", "title": "Song", "artists": [{"id": "a1", "name": "Artist"}], "durationMs": 1000})
}

fn write(name: &str, value: &impl Serialize) -> Value {
    let json = serde_json::to_value(value).unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(format!("{name}.json"));
    std::fs::write(path, serde_json::to_string_pretty(&json).unwrap() + "\n").unwrap();
    json
}

#[test]
fn library_fixtures() {
    let page = write("liked-tracks-page", &LikedTracksPage {
        items: vec![LikedTrackItem { track: with_viewer(track(), true), liked_at: iso_from_ms(0) }],
        next_cursor: None,
    });
    assert_eq!(page["items"][0]["likedAt"], "1970-01-01T00:00:00.000Z");
    assert!(page["nextCursor"].is_null(), "nextCursor must be present as null");

    let playlist = UserPlaylist {
        id: "p1".into(), title: "Mine".into(), description: None, is_public: false, pinned_offline: false,
        created_at: iso_from_ms(0), updated_at: iso_from_ms(0), revision: 1, owner_id: "local",
        sort_mode: "manual".into(), sort_desc: false, cover_url: Some("nuvo-core://local/v1/me/playlists/p1/cover?v=0".into()),
    };
    let detail = write("playlist-with-items", &PlaylistWithItems {
        playlist,
        items: vec![UserPlaylistItem { id: "i1".into(), track: track(), position: 1.0, added_at: iso_from_ms(0) }],
        total: None,
        next_cursor: None,
    });
    assert!(detail.get("total").is_none() && detail.get("nextCursor").is_none(), "the full detail keeps its old shape");
    assert_eq!(detail["playlist"]["isPublic"], false);
    assert_eq!(detail["playlist"]["sortMode"], "manual");
    assert_eq!(detail["playlist"]["coverUrl"], "nuvo-core://local/v1/me/playlists/p1/cover?v=0");
    assert!(detail["playlist"].get("description").is_none());
    assert_eq!(detail["items"][0]["addedAt"], "1970-01-01T00:00:00.000Z");
}

#[test]
fn playback_fixtures() {
    let history = write("history", &PlaybackHistoryResponse {
        items: vec![PlaybackHistoryItem {
            id: "1".into(), playback_session_id: "1".into(), listening_session_id: "s".into(), track: track(),
            played_duration_ms: 500, completion_rate: 0.5, completed: false, skipped: true, loop_count: 0,
            has_seek_backward: false, context: Some(PlaybackContext { kind: "playlist".into(), id: Some("p1".into()) }),
            listened_at: iso_from_ms(0),
        }],
        next_cursor: Some("1".into()),
    });
    assert_eq!(history["items"][0]["context"]["type"], "playlist");

    let popular = write("popular-tracks", &PopularTracksResponse {
        window: "7d".into(), generated_at: iso_from_ms(0),
        items: vec![PopularTrackItem { rank: 1, track: track(), play_count: 3, unique_listeners: 1, score: 3.0, viewer: Viewer { liked: false } }],
    });
    assert_eq!(popular["items"][0]["playCount"], 3);

    let albums = write("popular-albums", &PopularAlbumsResponse {
        window: "7d".into(),
        items: vec![PopularAlbumEntry { id: "al".into(), title: "A".into(), artist: "B".into(), cover_url: None, play_count: 1, unique_listeners: 1, track_count: 5, score: 1.0 }],
    });
    assert!(albums["items"][0]["coverUrl"].is_null());

    write("most-saved", &MostSavedResponse {
        kind: "all".into(),
        items: vec![MostSavedEntry { kind: "album".into(), id: "al".into(), title: "A".into(), subtitle: "".into(), cover_url: None, saves: 1 }],
    });
    let mixes = write("daily-mixes", &DailyMixesResponse {
        items: vec![DailyMixItem { id: "daily-mix-1".into(), title: "Artist Mix".into(), description: "".into(), cluster_artists: vec!["Artist".into()], cover: None, track_count: 1, tracks: vec![track()] }],
        generated_at: iso_from_ms(0),
    });
    assert_eq!(mixes["items"][0]["clusterArtists"][0], "Artist");
}

#[test]
fn lyrics_event_fixtures() {
    let candidate = LyricsCandidate {
        provider: "lrclib".into(), content_kind: "line_synced".into(), sync_level: "line_level".into(),
        quality: LyricsQuality { total: 0.8, match_score: 1.0, content: 1.0, sync: 0.6, source: 0.7, reasons: vec![] },
        lyrics: RawLyrics { format: "lrc".into(), content: "[00:01.00] hi".into() },
        matched_track: None,
        top_priority: false,
    };
    let events = write("lyrics-events", &vec![
        LyricsStreamEvent::Metadata { track: LyricsTrackMeta { id: "x".into(), title: "T".into(), artists: vec![json!({"id": "a", "name": "A"})], duration_ms: 1000 }, offset_ms: 0 },
        LyricsStreamEvent::Provider { provider: "lrclib".into(), status: "found", sync_level: Some("line_level".into()), candidate: Some(Box::new(candidate)), message: None, duration_ms: 12 },
        LyricsStreamEvent::Done { cached: false, best: Some(LyricsBest { provider: "lrclib".into(), quality: 0.8, sync_level: "line_level".into() }), status: None },
    ]);
    assert_eq!(events[0]["type"], "metadata");
    assert_eq!(events[0]["offsetMs"], 0);
    assert_eq!(events[1]["syncLevel"], "line_level");
    assert_eq!(events[1]["candidate"]["quality"]["match"], 1.0);
    assert_eq!(events[1]["durationMs"], 12);
    assert!(events[2].get("status").is_none());
}

#[test]
fn record_event_accepts_the_old_body_with_fractional_durations() {
    let body: RecordPlaybackEvent = serde_json::from_value(json!({
        "playbackSessionId": "p", "listeningSessionId": "l", "trackId": "t",
        "playedDurationMs": 1234.6, "trackDurationMs": 2000.2, "completionRate": 0.6,
        "completed": false, "skipped": true, "loopCount": 0, "hasSeekBackward": false,
        "context": {"type": "radio", "id": "t"}
    })).unwrap();
    assert_eq!(body.played_duration_ms, 1235);
    assert_eq!(body.track_duration_ms, Some(2000));
    assert_eq!(body.end_reason, None);
}

#[test]
fn update_playlist_distinguishes_null_from_absent() {
    let absent: UpdatePlaylist = serde_json::from_value(json!({"title": "x"})).unwrap();
    assert_eq!(absent.description, None);
    let cleared: UpdatePlaylist = serde_json::from_value(json!({"description": null})).unwrap();
    assert_eq!(cleared.description, Some(None));
}
