use nuvo_match::relevance::{Song, rank_songs, same_song};
use serde_json::{Value, json};

// YouTube Music and SoundCloud answers recorded on 2026-11-13, first ten songs of each
fn recorded(query: &str) -> Vec<Song> {
    let all: Value = serde_json::from_str(include_str!("fixtures/recorded-searches.json")).unwrap();
    let found = &all[query];
    found["youtube"].as_array().unwrap().iter().chain(found["soundcloud"].as_array().unwrap()).map(|t| Song::from_track(t).unwrap()).collect()
}

fn ranked(query: &str, songs: &[Song]) -> Vec<String> {
    rank_songs(query, songs).into_iter().map(|i| songs[i].id.clone()).collect()
}

fn song(id: &str, title: &str, artist: &str, ms: i64) -> Song {
    Song::from_track(&json!({"id": id, "title": title, "artists": [{"name": artist}], "durationMs": ms})).unwrap()
}

#[test]
fn recorded_searches_put_the_record_first() {
    let cases: [(&str, &[&str]); 12] = [
        ("daft punk get lucky", &["4D7u5KF7SP8", "sc:88335161", "sc:131973578"]),
        ("billie eilish bad guy", &["ZD6rXLXZOEI", "RYs-hL3fNJU", "sc:597923712"]),
        ("the weeknd blinding lights", &["J7p4bzqLvCw", "A6xjfv1hHUs"]),
        ("linkin park numb", &["5qZQEq_C3vc", "sc:1799046727", "sc:1066092496"]),
        ("imagine dragons believer", &["Kx7B-XvmFtE", "sc:555584253", "sc:572567274"]),
        ("кино группа крови", &["xtxjm7ciwmc", "EByofhvVRco", "sc:2112676515"]),
        ("земфира искала", &["eN_YiZ4uBe8", "sc:1434480934", "g2ECOFD2Ij8"]),
        ("макс корж мотылек", &["J7C_lyRbs7k", "Hws-ud5ylhY", "sc:296280603"]),
        ("kino gruppa krovi", &["Ncfm6Fphhlo", "sc:331371017", "0RVAxf2KO3I"]),
        ("ptvabhf bcrfkf", &["eN_YiZ4uBe8", "iz6S2a94Gy4", "i5PA9DQMIPY"]),
        ("скриптонит положение", &["k7jB3lo7ogw", "sc:2124930756", "Yetd31aA1ow"]),
        ("miyagi i got love", &["YkY4X_OaF6o", "hQWVfGAYaBY", "dP1nPxTYGuo"]),
    ];
    for (query, top) in cases {
        assert_eq!(ranked(query, &recorded(query))[..top.len()], *top, "{query}");
    }
}

#[test]
fn keeps_one_copy_of_a_song_both_sources_carry() {
    let numb = ranked("linkin park numb", &recorded("linkin park numb"));
    assert!(numb.contains(&"5qZQEq_C3vc".into()) && !numb.contains(&"sc:255824765".into()));
    let love = ranked("miyagi i got love", &recorded("miyagi i got love"));
    assert!(love.contains(&"YkY4X_OaF6o".into()) && !love.contains(&"sc:1659350931".into()) && !love.contains(&"sc:303470054".into()));
}

#[test]
fn previews_follow_full_songs_and_remixes_follow_the_record() {
    let lucky = ranked("daft punk get lucky", &recorded("daft punk get lucky"));
    let at = |list: &[String], id: &str| list.iter().position(|x| x == id).unwrap();
    assert!(at(&lucky, "sc:254111945") > at(&lucky, "sc:88335161"));
    assert!(at(&lucky, "sc:250790590") > at(&lucky, "sc:131973578"));
    let numb = ranked("linkin park numb", &recorded("linkin park numb"));
    assert!(at(&numb, "sc:2196784679") > at(&numb, "sc:1799046727"));
    let lights = ranked("the weeknd blinding lights", &recorded("the weeknd blinding lights"));
    assert!(at(&lights, "sc:2403985545") > at(&lights, "A6xjfv1hHUs"));
}

#[test]
fn matches_a_query_typed_in_the_wrong_keyboard_layout() {
    let songs = [song("sc:1", "Другая песня", "Кто-то", 200_000), song("sc:2", "Искала", "Земфира", 200_000)];
    assert_eq!(ranked("ptvabhf bcrfkf", &songs), ["sc:2", "sc:1"]);
}

#[test]
fn matches_a_transliterated_query() {
    let songs = [song("sc:1", "Пачка сигарет", "Кино", 200_000), song("sc:2", "Группа крови", "Кино", 200_000)];
    assert_eq!(ranked("kino gruppa krovi", &songs)[0], "sc:2");
}

#[test]
fn keeps_the_order_while_the_last_word_is_still_being_typed() {
    let songs = recorded("linkin park numb");
    assert_eq!(ranked("linkin park nu", &songs)[..3], ranked("linkin park numb", &songs)[..3]);
}

#[test]
fn keeps_the_given_order_between_equal_matches() {
    let songs = [song("a1", "Song", "Nova", 200_000), song("a2", "Song", "Nova", 260_000)];
    assert_eq!(ranked("nova song", &songs), ["a1", "a2"]);
}

#[test]
fn a_song_from_two_sources_is_one_song_only_at_one_length() {
    assert!(same_song(&song("yt", "Numb", "Linkin Park", 187_000), &song("sc:1", "Linkin Park - Numb", "someone", 186_000)));
    assert!(!same_song(&song("yt", "Numb", "Linkin Park", 187_000), &song("sc:1", "Numb", "Linkin Park", 206_000)));
}

#[test]
fn the_uploader_can_mark_a_version() {
    let songs = [song("sc:1", "Numb", "Nightcore Hits", 160_000), song("sc:2", "Numb", "Linkin Park", 187_000)];
    assert_eq!(ranked("numb", &songs)[0], "sc:2");
}

#[test]
fn the_better_match_leads_whatever_its_source() {
    let songs = [song("yt1", "Harbor Lights (Karaoke Version)", "Sing Along", 200_000), song("sc:1", "Harbor Lights", "Nova", 200_000)];
    assert_eq!(ranked("nova harbor lights", &songs), ["sc:1", "yt1"]);
}
