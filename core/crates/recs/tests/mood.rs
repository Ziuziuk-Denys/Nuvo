mod common;

use common::{DAY, NOW, play, skip};
use nuvo_recs::mood::{self, Sound};
use nuvo_recs::{pool, suppress};
use serde_json::json;

fn tone(hz: f32, gain: f32, beat: bool) -> Vec<f32> {
    let rate = mood::SAMPLE_RATE as f32;
    (0..mood::SAMPLE_RATE * 20)
        .map(|i| {
            let t = i as f32 / rate;
            let gate = if beat && (t * 4.0).fract() > 0.3 { 0.05 } else { 1.0 };
            (t * hz * std::f32::consts::TAU).sin() * gain * gate
        })
        .collect()
}

#[test]
fn louder_beating_and_higher_sounds_measure_so() {
    let soft = mood::measure(&tone(220.0, 0.05, false)).unwrap();
    let loud = mood::measure(&tone(220.0, 0.6, false)).unwrap();
    let beating = mood::measure(&tone(220.0, 0.6, true)).unwrap();
    let high = mood::measure(&tone(3000.0, 0.6, false)).unwrap();
    assert!(loud.loudness > soft.loudness + 15.0);
    assert!(beating.punch > loud.punch * 2.0, "{beating:?} {loud:?}");
    assert!(high.brightness > loud.brightness + 2.0);
    assert_eq!(mood::measure(&vec![0.0; 32_000]), None);
    assert_eq!(mood::measure(&[0.1; 10]), None);
}

#[test]
fn the_map_places_songs_and_borrows_places_for_unheard_ones() {
    let (_dir, conn) = common::open();
    let sound = |n: usize| Sound { loudness: -30.0 + n as f64, punch: 0.1 + n as f64 / 100.0, brightness: 12.0 - n as f64 / 10.0 };
    for n in 0..mood::MIN_SONGS - 1 {
        play(&conn, &format!("t{n:02}"), &format!("artist{n}"), "s", NOW - DAY + n as i64, json!({}));
        mood::store(&conn, &format!("t{n:02}"), Some(sound(n)), NOW).unwrap();
    }
    play(&conn, "unmeasured", "artist", "s", NOW - DAY + 100, json!({}));
    mood::store(&conn, "unmeasured", None, NOW).unwrap();
    let young = mood::map(&conn, NOW).unwrap();
    assert_eq!((young.analysed, young.points.len()), (mood::MIN_SONGS - 1, 0));

    play(&conn, "t11", "artist11", "s", NOW - DAY + 200, json!({}));
    mood::store(&conn, "t11", Some(sound(11)), NOW).unwrap();
    pool::replace(&conn, "t11", pool::YT_RADIO, &[common::snapshot("new", "New", "new"), common::snapshot("no", "No", "no"), common::snapshot("t00", "Song t00", "artist0")], NOW).unwrap();
    suppress::not_interested(&conn, "no", "exact", NOW).unwrap();
    play(&conn, "t05", "artist5", "s", NOW - DAY + 300, skip(40_000));
    let map = mood::map(&conn, NOW).unwrap();
    let find = |id: &str| map.points.iter().find(|p| p.track["id"] == id);
    assert_eq!(map.analysed, mood::MIN_SONGS);
    assert!(find("t11").unwrap().energy > 0.9 && find("t11").unwrap().brightness < 0.1);
    assert!(find("t00").unwrap().energy < 0.1 && !find("t00").unwrap().fresh);
    let new = find("new").unwrap();
    assert!(new.fresh && (new.energy - find("t11").unwrap().energy).abs() < 1e-9);
    assert!(find("no").is_none() && find("unmeasured").is_none());
}

#[test]
fn only_kept_audio_without_a_measure_is_due() {
    let (_dir, conn) = common::open();
    for (n, id) in ["streamed", "older", "newer"].into_iter().enumerate() {
        play(&conn, id, "artist", "s", NOW - DAY + n as i64, json!({}));
        if id != "streamed" {
            conn.execute(
                "INSERT INTO cache_entries (track_id, path, size_bytes, mime, last_played_at) VALUES (?1, ?1, 1, 'audio/webm', ?2)",
                (id, n as i64),
            )
            .unwrap();
        }
    }
    assert_eq!(mood::next_due(&conn).unwrap().as_deref(), Some("newer"));
    mood::store(&conn, "newer", None, NOW).unwrap();
    assert_eq!(mood::next_due(&conn).unwrap().as_deref(), Some("older"));
    mood::store(&conn, "older", None, NOW).unwrap();
    assert_eq!(mood::next_due(&conn).unwrap(), None);
}
