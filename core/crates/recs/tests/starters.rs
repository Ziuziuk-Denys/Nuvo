mod common;

use common::{DAY, NOW, play, snapshot};
use nuvo_contracts::CreatePlaylist;
use nuvo_recs::{mixes, pool, rewards, starters};
use nuvo_store::{Connection, playlists};
use serde_json::{Value, json};

fn picks() -> Vec<Value> {
    vec![snapshot("st1", "Star One", "Sol"), snapshot("st2", "Star Two", "Sol"), snapshot("st3", "Star Three", "Luna")]
}

fn playlist(conn: &Connection, title: &str, tracks: Vec<Value>) -> String {
    let id = playlists::create(conn, &CreatePlaylist { title: title.into(), description: None, is_public: false }, NOW).unwrap().id;
    playlists::add_tracks(conn, &id, tracks, NOW).unwrap();
    id
}

#[test]
fn a_fresh_library_asks_and_starters_become_seeds() {
    let (_dir, conn) = common::open();
    assert!(starters::needed(&conn).unwrap());
    assert!(starters::replace(&conn, &[], NOW).is_err());
    let many: Vec<Value> = (0..16).map(|i| snapshot(&format!("m{i}"), "M", "X")).collect();
    assert!(starters::replace(&conn, &many, NOW).is_err());
    assert_eq!(starters::replace(&conn, &picks(), NOW).unwrap(), 3);
    assert!(!starters::needed(&conn).unwrap());
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::YT_RADIO).unwrap(), ["st1", "st2", "st3"]);

    play(&conn, "own", "Me", "s", NOW - DAY, json!({}));
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::YT_RADIO).unwrap()[0], "own", "the owner's own plays lead");
}

#[test]
fn playlist_tracks_are_seeds_after_starters_unless_the_playlist_is_excluded() {
    let (_dir, conn) = common::open();
    playlist(&conn, "Mine", vec![snapshot("p1", "P1", "Pia")]);
    let gym = playlist(&conn, "Gym", vec![snapshot("g1", "G1", "Gus")]);
    rewards::set_excluded(&conn, "playlist", &gym, true).unwrap();
    assert!(!starters::needed(&conn).unwrap(), "an own or imported playlist already tells the taste");
    starters::replace(&conn, &picks()[..1], NOW).unwrap();
    assert_eq!(pool::stale_seeds(&conn, NOW, pool::YT_RADIO).unwrap(), ["st1", "p1"]);
}

#[test]
fn new_to_you_grows_from_starters_and_never_offers_a_playlist_track() {
    let (_dir, conn) = common::open();
    playlist(&conn, "Mine", vec![snapshot("p1", "P1", "Pia")]);
    starters::replace(&conn, &picks(), NOW).unwrap();
    let list = [snapshot("n1", "Nova", "Nova"), snapshot("n2", "Orbit", "Orbit"), snapshot("n3", "Comet", "Comet"), snapshot("p1", "P1", "Pia")];
    pool::replace(&conn, "st1", pool::YT_RADIO, &list, NOW - 10).unwrap();
    let all = serde_json::to_value(mixes::daily_mixes(&conn, NOW).unwrap()).unwrap();
    let items = all["items"].as_array().unwrap();
    let discover = items.iter().find(|m| m["id"] == "daily-mix-discover").expect("New to you from starters alone");
    let found: Vec<&str> = discover["tracks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert!(found.contains(&"n1") && !found.contains(&"p1"), "{found:?}");
    assert!(items.iter().all(|m| m["id"] != "daily-mix-for-you"), "starters are not the owner's own taste");
}

#[test]
fn malformed_starter_snapshots_are_rejected_and_leave_the_old_ones() {
    let (_dir, conn) = common::open();
    assert_eq!(starters::replace(&conn, &picks(), NOW).unwrap(), 3);
    let long = "x".repeat(301);
    let mut crowd = snapshot("ok1", "Fine", "Sol");
    crowd["artists"] = Value::Array((0..17).map(|i| json!({"id": format!("a{i}"), "name": "A"})).collect());
    let bad = [
        snapshot("has space", "T", "A"),
        snapshot("yt/../x", "T", "A"),
        snapshot("sc:abc", "T", "A"),
        snapshot("soundcloud:12", "T", "A"),
        snapshot(&"i".repeat(33), "T", "A"),
        snapshot("ok1", &long, "A"),
        snapshot("ok1", "T", &long),
        crowd,
    ];
    for pick in bad {
        let err = starters::replace(&conn, &[snapshot("good1", "G", "Sol"), pick.clone()], NOW);
        assert!(err.is_err(), "rejected: {pick}");
    }
    assert_eq!(starters::replace(&conn, &[snapshot("sc:123", "Cloud", "Sol"), snapshot("dQw4w9WgXcQ", "Tube", "Sol")], NOW).unwrap(), 2);
    let kept: i64 = conn.query_row("SELECT count(*) FROM rec_starters", [], |r| r.get(0)).unwrap();
    assert_eq!(kept, 2, "a rejected request changes nothing");
}
