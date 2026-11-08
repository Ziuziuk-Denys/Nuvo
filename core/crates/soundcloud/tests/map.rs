use nuvo_soundcloud::link::{self, Link};
use nuvo_soundcloud::{ids, map};
use serde_json::{Value, json};

fn user(id: u64, name: &str) -> Value {
    json!({"id": id, "kind": "user", "username": name, "avatar_url": format!("https://i1.sndcdn.com/avatars-{id}-large.jpg")})
}

#[test]
fn id_formats_round_trip() {
    for id in ["sc:77", "soundcloud:tracks:77", "soundcloud:track:77", "soundcloud:77", "77", " SC:77 ", "SoundCloud:Tracks:77"] {
        assert_eq!(ids::track_num(id), Some(77), "{id}");
    }
    for id in ["sc_user_77", "sc:", "sc:7a", "Ab3dE_fG9hI", "", "yt:77"] {
        assert_eq!(ids::track_num(id), None, "{id}");
    }
    assert_eq!(ids::user_num(" sc_user_9 "), Some(9));
    assert_eq!(ids::user_num("UC123"), None);
    assert_eq!(ids::set_num("sc_playlist_5"), Some(5));
    assert_eq!(ids::set_num("sc_user_5"), None);
    assert!(ids::is_soundcloud(" SC_user_1") && ids::is_soundcloud("sc:1") && !ids::is_soundcloud("dQw4w9WgXcQ"));
    assert_eq!((ids::track_id(1), ids::user_id(2), ids::set_id(3)), ("sc:1".into(), "sc_user_2".into(), "sc_playlist_3".into()));
}

#[test]
fn artwork_tokens_become_500_and_keep_the_original() {
    assert_eq!(map::sized_500("https://i1.sndcdn.com/artworks-abc-large.jpg"), "https://i1.sndcdn.com/artworks-abc-t500x500.jpg");
    assert_eq!(map::sized_500("https://i1.sndcdn.com/a-b-t67x67.png?x=1"), "https://i1.sndcdn.com/a-b-t500x500.png?x=1");
    assert_eq!(map::sized_500("https://i1.sndcdn.com/a-crop.jpg"), "https://i1.sndcdn.com/a-t500x500.jpg");
    assert_eq!(map::sized_500("https://i1.sndcdn.com/a-original.jpg"), "https://i1.sndcdn.com/a-t500x500.jpg");
    assert_eq!(map::sized_500("https://i1.sndcdn.com/a-small.jpg"), "https://i1.sndcdn.com/a-small.jpg");
    assert_eq!(map::cover(Some("  ")), None);
}

#[test]
fn a_track_without_artwork_uses_the_uploader_avatar() {
    let record = json!({"id": 5, "title": " Song ", "duration": 1000, "artwork_url": null, "user": user(9, "nightowl")});
    let track = map::track(&record).unwrap();
    let cover = track.cover.unwrap();
    assert_eq!(cover.url, "https://i1.sndcdn.com/avatars-9-t500x500.jpg");
    assert_eq!((cover.width, cover.height), (500, 500));
    assert_eq!(cover.fallback_url.as_deref(), Some("https://i1.sndcdn.com/avatars-9-large.jpg"));
    assert_eq!(track.title, "Song");
    assert_eq!(track.artists[0].id, "sc_user_9");
    assert_eq!(track.explicit, None);
}

#[test]
fn records_without_id_or_title_are_not_tracks() {
    assert!(map::track(&json!({"title": "x"})).is_none());
    assert!(map::track(&json!({"id": 1, "title": "  "})).is_none());
    let track = map::track(&json!({"id": 1, "title": "x", "duration": -5, "user": {"id": 2}})).unwrap();
    assert_eq!((track.duration_ms, track.artists.len(), track.cover), (0, 0, None));
}

#[test]
fn track_details_carry_explicit_description_and_display_date() {
    let record = json!({"id": 5, "title": "Song", "publisher_metadata": {"explicit": true}, "description": " notes ", "display_date": "2020-01-02T00:00:00Z", "user": user(9, "u")});
    let details = map::track_details(&record).unwrap();
    assert_eq!(details.track.explicit, Some(true));
    assert_eq!(details.description.as_deref(), Some("notes"));
    assert_eq!(details.release_date.as_deref(), Some("2020-01-02T00:00:00Z"));
    let wire = serde_json::to_value(&details).unwrap();
    assert_eq!(wire["durationMs"], 0);
    assert_eq!(wire["releaseDate"], "2020-01-02T00:00:00Z");
}

#[test]
fn year_uses_the_first_date_present() {
    assert_eq!(map::year(&json!({"release_date": "1899-01-01", "created_at": "2021-03-04"})), None);
    assert_eq!(map::year(&json!({"release_date": "", "display_date": "2019-05-01"})), Some(2019));
    assert_eq!(map::year(&json!({"created_at": "2021/03/04"})), Some(2021));
    assert_eq!(map::year(&json!({"created_at": "abcd"})), None);
}

#[test]
fn set_views_and_cover_fallbacks() {
    let set = json!({"id": 3, "title": "Mix", "description": "d", "user": user(9, "dj"), "artwork_url": null});
    let tracks = vec![
        json!({"id": 31, "title": "A", "duration": 1000, "artwork_url": "https://i1.sndcdn.com/artworks-31-large.jpg"}),
        json!({"id": 32, "title": "B", "duration": 2000}),
    ];
    let album = map::album(&set, &tracks).unwrap();
    assert_eq!(album.cover.unwrap().url, "https://i1.sndcdn.com/artworks-31-t500x500.jpg");
    assert_eq!((album.track_count, album.duration_ms), (2, 3000));
    assert_eq!(album.artists[0].name, "dj");
    let album_wire = serde_json::to_value(map::album(&set, &tracks).unwrap()).unwrap();
    assert!(album_wire.get("author").is_none());
    let playlist = map::playlist(&set, &tracks).unwrap();
    assert_eq!((playlist.author.as_str(), playlist.description.as_deref()), ("dj", Some("d")));
    let bare = map::playlist(&set, &[json!({"id": 33, "title": "C"})]).unwrap();
    assert_eq!(bare.cover.unwrap().url, "https://i1.sndcdn.com/avatars-9-t500x500.jpg");
    assert!(map::album(&json!({"id": 3}), &[]).is_none(), "a set without a title is not found");
}

/// The mapping level.
#[test]
fn release_types_sort_sets_into_albums_and_singles() {
    let set = |t: Value| json!({"id": 1, "title": "x", "set_type": t, "track_count": 4});
    assert_eq!(map::release_type(&set(json!("single"))), Some("single"));
    assert_eq!(map::release_type(&set(json!("EP"))), Some("ep"));
    assert_eq!(map::release_type(&set(json!("album"))), None);
    assert_eq!(map::release_type(&set(json!(""))), None);
    let summary = map::set_summary(&set(json!("ep"))).unwrap();
    assert_eq!((summary.track_count, summary.total_tracks), (Some(4), Some(4)));
    assert!(map::is_album(&json!({"set_type": "album"})) && map::is_album(&json!({"is_album": true})));
    assert!(!map::is_album(&json!({"set_type": ""})) && !map::is_album(&json!({})));
}

#[test]
fn links_are_recognised_and_canonicalised() {
    for input in ["soundcloud.com/someone", "https://www.soundcloud.com/someone", "HTTPS://M.SOUNDCLOUD.COM/someone", " on.soundcloud.com/AbC "] {
        assert!(link::is_link(input), "{input}");
    }
    for input in ["soundcloud.com/", "soundcloud.com/   ", "night owl", "https://example.com/soundcloud.com/x"] {
        assert!(!link::is_link(input), "{input}");
    }
    assert_eq!(link::parse("https://m.soundcloud.com/someone/sets/mix?si=abc"), Some(Link::Canonical("https://soundcloud.com/someone/sets/mix".into())));
    assert_eq!(link::parse("soundcloud.com/a#t=1"), Some(Link::Canonical("https://soundcloud.com/a".into())));
    assert_eq!(link::parse("http://on.soundcloud.com/AbC"), Some(Link::Short("https://on.soundcloud.com/AbC".into())));
}
