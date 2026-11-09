mod common;

use std::collections::HashSet;

use common::{DAY, NOW, play, skip, snapshot};
use nuvo_contracts::RankRequest;
use nuvo_recs::{features, mixes, pool, rank, rewards, suppress};
use nuvo_store::{Connection, library};
use serde_json::{Value, json};

fn mix_ids(mix: &Value) -> Vec<String> {
    mix["tracks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_string()).collect()
}

fn mixes_json(conn: &Connection, now: i64) -> Vec<Value> {
    serde_json::to_value(mixes::daily_mixes(conn, now).unwrap()).unwrap()["items"].as_array().unwrap().clone()
}

fn find<'a>(mixes: &'a [Value], id: &str) -> Option<&'a Value> {
    mixes.iter().find(|m| m["id"] == id)
}

#[test]
fn home_mixes_follow_taste_and_hide_what_should_not_show() {
    let (_dir, conn) = common::open();
    for i in 0..4 {
        play(&conn, &format!("x{i}"), "Xavier", "s1", NOW - DAY + i, json!({}));
        play(&conn, &format!("x{i}"), "Xavier", "s2", NOW - DAY + 10 + i, json!({}));
    }
    for i in 0..3 {
        play(&conn, &format!("y{i}"), "Yara", "s3", NOW - DAY + 20 + i, json!({}));
    }
    play(&conn, "z0", "Zed", "s4", NOW - DAY + 30, skip(60_000));
    for i in 0..3 {
        library::like(&conn, &format!("l{i}"), Some(snapshot(&format!("l{i}"), &format!("Liked {i}"), "Lena")), NOW - 100 + i).unwrap();
    }
    library::like(&conn, "hidden", Some(snapshot("hidden", "Hidden", "Lena")), NOW).unwrap();
    suppress::not_interested(&conn, "hidden", "exact", NOW).unwrap();
    suppress::not_interested(&conn, "y2", "work", NOW).unwrap();
    rewards::set_excluded(&conn, "track", "x3", true).unwrap();

    let all = mixes_json(&conn, NOW);
    let ids: Vec<&str> = all.iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(ids[0], "daily-mix-for-you");
    assert!(ids.iter().all(|id| id.starts_with("daily-mix-")), "{ids:?}");
    let for_you = mix_ids(find(&all, "daily-mix-for-you").unwrap());
    assert!(!for_you.contains(&"z0".to_string()), "a skipped track is not for you");
    for gone in ["hidden", "y2", "x3"] {
        assert!(all.iter().all(|m| !mix_ids(m).contains(&gone.to_string())), "{gone} must not show");
    }
    let artist = find(&all, "daily-mix-artist-1").unwrap();
    assert_eq!((artist["title"].as_str(), artist["clusterArtists"][0].as_str()), (Some("Lena Mix"), Some("Lena")));
    assert_eq!(mix_ids(find(&all, "daily-mix-recent-likes").unwrap()), ["l2", "l1", "l0"]);
    assert!(find(&all, "daily-mix-mood-energy").is_none(), "no moods before 200 analysed tracks");
    assert!(find(&all, "daily-mix-discover").is_none(), "no candidate lists, no New to you");
}

#[test]
fn discover_mix_brings_unheard_tracks_from_the_pool() {
    let (_dir, conn) = common::open();
    for i in 0..3 {
        play(&conn, &format!("s{i}"), "Seeder", "s", NOW - DAY + i, json!({}));
    }
    library::like(&conn, "liked", Some(snapshot("liked", "Liked", "Lena")), NOW - 100).unwrap();
    let items = vec![
        snapshot("n1", "Nova One", "Nova"),
        snapshot("n2", "Nova Two", "Nova"),
        snapshot("n3", "Nova Three", "Nova"),
        snapshot("o1", "Orbit One", "Orbit"),
        snapshot("o2", "Orbit Two", "Orbit"),
        snapshot("s1", "Song s1", "Seeder"),
        snapshot("liked", "Liked", "Lena"),
        snapshot("dup", "Song s2", "Seeder"),
        snapshot("h1", "Hidden", "Hera"),
        snapshot("x1", "Excluded", "Xena"),
    ];
    pool::replace(&conn, "s0", "yt_radio", &items, NOW - 10).unwrap();
    suppress::not_interested(&conn, "h1", "exact", NOW).unwrap();
    rewards::set_excluded(&conn, "track", "x1", true).unwrap();

    let all = mixes_json(&conn, NOW);
    let ids: Vec<&str> = all.iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(&ids[..2], ["daily-mix-for-you", "daily-mix-discover"]);
    let found = mix_ids(find(&all, "daily-mix-discover").unwrap());
    for heard in ["s1", "liked", "dup", "h1", "x1"] {
        assert!(!found.contains(&heard.to_string()), "{heard} is not new or must not show: {found:?}");
    }
    assert_eq!(found.iter().filter(|id| id.starts_with('n')).count(), 2, "at most 2 per artist: {found:?}");
    assert!(found.contains(&"n1".to_string()) && found.contains(&"o1".to_string()) && found.contains(&"o2".to_string()), "{found:?}");

    let tomorrow = mix_ids(find(&mixes_json(&conn, NOW + DAY), "daily-mix-discover").unwrap());
    assert_eq!(tomorrow.len(), found.len(), "a small pool still fills the mix the next day");
}

#[test]
fn home_does_not_repeat_yesterday() {
    let (_dir, conn) = common::open();
    for i in 0..40 {
        play(&conn, &format!("t{i:02}"), &format!("artist{}", i / 2), "s", NOW - DAY + i, json!({}));
    }
    let day1: Vec<String> = mix_ids(find(&mixes_json(&conn, NOW), "daily-mix-for-you").unwrap());
    assert_eq!(day1.len(), mixes::MIX_SIZE);
    let again: Vec<String> = mix_ids(find(&mixes_json(&conn, NOW + 3_600_000), "daily-mix-for-you").unwrap());
    assert_eq!(again, day1, "the same day shows the same mix");

    let day2: Vec<String> = mix_ids(find(&mixes_json(&conn, NOW + DAY), "daily-mix-for-you").unwrap());
    let shown: HashSet<&String> = day1.iter().collect();
    let unshown = 40 - mixes::MIX_SIZE;
    assert!(day2[..unshown].iter().all(|id| !shown.contains(id)), "yesterday's tracks go to the back: {day2:?}");
}

/// 20 values; tempo at 0, brightness at 2, loudness at 8 (the mood axes).
fn vector(energy: f32, bright: f32) -> Vec<f32> {
    let mut v = vec![0.0; 20];
    v[0] = energy;
    v[8] = energy;
    v[2] = bright;
    v
}

fn quadrant(n: usize) -> (&'static str, f32, f32) {
    match n % 4 {
        0 => ("energy", 0.8, -0.5),
        1 => ("bright", 0.8, 0.5),
        2 => ("calm", -0.8, 0.5),
        _ => ("late-night", -0.8, -0.5),
    }
}

#[test]
fn moods_need_200_analysed_tracks_and_drive_mood_radio() {
    let (_dir, conn) = common::open();
    for n in 0..199 {
        let (_, energy, bright) = quadrant(n);
        let id = format!("m{n:03}");
        library::like(&conn, &id, Some(snapshot(&id, &format!("Mood {n}"), &format!("artist{}", n % 40))), NOW - 1000 + n as i64).unwrap();
        features::store(&conn, &id, mixes::MOOD_LAYOUT_VERSION, &vector(energy, bright), NOW).unwrap();
    }
    assert!(mixes::moods(&conn).unwrap().is_empty());
    library::like(&conn, "m199", Some(snapshot("m199", "Mood 199", "artist39")), NOW).unwrap();
    features::store(&conn, "m199", mixes::MOOD_LAYOUT_VERSION, &vector(-0.8, -0.5), NOW).unwrap();
    let moods = mixes::moods(&conn).unwrap();
    assert_eq!(moods.len(), 200);
    assert_eq!(moods["m000"], "energy");
    assert_eq!(moods["m002"], "calm");

    let all = mixes_json(&conn, NOW);
    for (key, title) in mixes::MOODS {
        let mix = find(&all, &format!("daily-mix-mood-{key}")).unwrap();
        assert_eq!(mix["title"], title);
        assert!(mix_ids(mix).iter().all(|id| moods[id] == key), "{key} mix is mood-consistent");
    }

    let mut candidates = Vec::new();
    for n in 0..20 {
        let (mood, energy, bright) = if n % 2 == 0 { ("energy", 0.8, -0.5) } else { ("calm", -0.8, 0.5) };
        let id = format!("c{n}-{mood}");
        candidates.push(snapshot(&id, &format!("Candidate {n}"), &format!("cand{n}")));
        nuvo_store::tracks::upsert(&conn, &snapshot(&id, &format!("Candidate {n}"), &format!("cand{n}")), NOW).unwrap();
        features::store(&conn, &id, mixes::MOOD_LAYOUT_VERSION, &vector(energy, bright), NOW).unwrap();
    }
    let req = RankRequest { context: "mix:mood:energy".into(), candidates, ..Default::default() };
    let batch = rank::rank(&conn, &req, NOW, 4).unwrap();
    assert_eq!(batch.items.len(), 10);
    assert!(batch.items.iter().all(|i| i.track["id"].as_str().unwrap().ends_with("energy")), "mood radio refills with its mood");
    let bad = RankRequest { context: "mix:mood:sleepy".into(), ..Default::default() };
    assert!(rank::rank(&conn, &bad, NOW, 4).is_err());
}

#[test]
fn small_library_all_shown_yesterday_still_has_for_you() {
    let (_dir, conn) = common::open();
    for i in 0..5 {
        play(&conn, &format!("t{i}"), &format!("artist{i}"), "s", NOW - 3 * DAY + i, json!({}));
    }
    let mut yesterday = mix_ids(find(&mixes_json(&conn, NOW - DAY), "daily-mix-for-you").unwrap());
    assert_eq!(yesterday.len(), 5);
    let today = find(&mixes_json(&conn, NOW), "daily-mix-for-you").map(mix_ids);
    let mut today = today.expect("For you exists when every track was shown yesterday");
    today.sort();
    yesterday.sort();
    assert_eq!(today, yesterday, "repeats sort last but stay");
}

#[test]
fn tracks_without_an_artist_are_not_capped_as_one_artist() {
    let (_dir, conn) = common::open();
    for i in 0..6 {
        play(&conn, &format!("u{i}"), "?", "s", NOW - DAY + i, json!({}));
        play(&conn, &format!("u{i}"), "?", "s2", NOW - DAY + 10 + i, json!({}));
    }
    let for_you = mix_ids(find(&mixes_json(&conn, NOW), "daily-mix-for-you").unwrap());
    assert_eq!(for_you.len(), 6, "{for_you:?}");
}

#[test]
fn a_broken_candidate_snapshot_empties_new_to_you_but_keeps_the_other_mixes() {
    let (_dir, conn) = common::open();
    for i in 0..3 {
        play(&conn, &format!("s{i}"), "Seeder", "s", NOW - DAY + i, json!({}));
    }
    let items = vec![snapshot("n1", "Nova One", "Nova"), snapshot("o1", "Orbit One", "Orbit"), snapshot("p1", "Pia One", "Pia"), snapshot("q1", "Quill One", "Quill")];
    pool::replace(&conn, "s0", "yt_radio", &items, NOW - 10).unwrap();
    conn.execute("UPDATE tracks SET snapshot_json = 'not json' WHERE id = 'n1'", []).unwrap();

    let all = mixes_json(&conn, NOW);
    assert!(find(&all, "daily-mix-discover").is_none());
    assert!(find(&all, "daily-mix-for-you").is_some());
}

#[test]
fn the_artist_cap_follows_the_first_artist_of_a_multi_artist_snapshot() {
    let (_dir, conn) = common::open();
    for i in 0..3 {
        play(&conn, &format!("s{i}"), "Seeder", "s", NOW - DAY + i, json!({}));
    }
    let items: Vec<Value> = (1..=3)
        .map(|i| json!({"id": format!("n{i}"), "title": format!("Nova {i}"), "artists": [{"id": "a", "name": "Nova"}, {"id": format!("g{i}"), "name": format!("Guest {i}")}], "durationMs": 200000}))
        .collect();
    let mut items = items;
    items.push(snapshot("o1", "Orbit One", "Orbit"));
    pool::replace(&conn, "s0", "yt_radio", &items, NOW - 10).unwrap();
    let found = mix_ids(find(&mixes_json(&conn, NOW), "daily-mix-discover").unwrap());
    assert_eq!(found.iter().filter(|id| id.starts_with('n')).count(), 2, "guests do not dodge the per-artist cap: {found:?}");
}

#[test]
fn a_database_failure_while_building_new_to_you_is_not_hidden() {
    let (_dir, conn) = common::open();
    for i in 0..3 {
        play(&conn, &format!("s{i}"), "Seeder", "s", NOW - DAY + i, json!({}));
    }
    conn.execute("DROP TABLE candidate_edges", []).unwrap();
    assert!(mixes::daily_mixes(&conn, NOW).is_err());
}
