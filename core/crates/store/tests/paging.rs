mod common;

use nuvo_contracts::{CreatePlaylist, UpdatePlaylist};
use nuvo_store::{Connection, StoreError, playlists};
use serde_json::{Value, json};

fn snapshot(i: usize) -> Value {
    let album = if i.is_multiple_of(7) { Value::Null } else { json!({"id": format!("al{}", i % 13), "title": format!("Album {}", i % 13)}) };
    json!({
        "id": format!("t{i}"),
        "title": if i.is_multiple_of(5) { format!("кино {i}") } else { format!("Song {}", (i * 7919) % 1000) },
        "artists": [{"id": "a", "name": format!("Artist {}", i % 17)}],
        "album": album,
        "durationMs": 120_000 + (i * 37 % 200) * 1000,
    })
}

fn playlist_with(conn: &Connection, count: usize) -> String {
    let id = playlists::create(conn, &CreatePlaylist { title: "Big".into(), description: None, is_public: false }, 1).unwrap().id;
    let all: Vec<Value> = (0..count).map(snapshot).collect();
    for chunk in all.chunks(5000) {
        playlists::add_tracks(conn, &id, chunk.to_vec(), 2).unwrap();
    }
    id
}

fn sort(conn: &Connection, id: &str, mode: &str, desc: bool) {
    let input = UpdatePlaylist { sort_mode: Some(mode.into()), sort_desc: Some(desc), ..Default::default() };
    playlists::update(conn, id, &input, 3).unwrap();
}

/// Item ids of every page, in order, and the totals each page reported.
fn walk(conn: &Connection, id: &str, limit: usize, q: Option<&str>) -> (Vec<String>, Vec<usize>) {
    let (mut ids, mut totals, mut cursor) = (Vec::new(), Vec::new(), None);
    loop {
        let page = playlists::items_page(conn, id, cursor.as_deref(), limit, q).unwrap();
        assert!(page.items.len() <= limit);
        ids.extend(page.items.iter().map(|i| i.id.clone()));
        totals.push(page.total);
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    (ids, totals)
}

fn detail_ids(conn: &Connection, id: &str) -> Vec<String> {
    playlists::get(conn, id).unwrap().items.into_iter().map(|i| i.id).collect()
}

#[test]
fn every_sort_mode_pages_in_the_detail_order() {
    let (_dir, conn) = common::open();
    let id = playlist_with(&conn, 300);
    for mode in playlists::SORT_MODES {
        for desc in [false, true] {
            sort(&conn, &id, mode, desc);
            let (paged, totals) = walk(&conn, &id, 7, None);
            assert_eq!(paged, detail_ids(&conn, &id), "{mode} desc={desc}");
            assert!(totals.iter().all(|t| *t == 300));
        }
    }
}

#[test]
fn ten_thousand_items_page_completely() {
    let (_dir, conn) = common::open();
    let id = playlist_with(&conn, 10_000);
    for (mode, desc) in [("manual", false), ("title", true), ("album", false)] {
        sort(&conn, &id, mode, desc);
        let (paged, _) = walk(&conn, &id, playlists::PAGE_DEFAULT, None);
        assert_eq!(paged.len(), 10_000);
        assert_eq!(paged, detail_ids(&conn, &id), "{mode}");
    }
    let head = playlists::get_head(&conn, &id, 500).unwrap();
    assert_eq!((head.items.len(), head.total), (500, Some(10_000)));
    assert_eq!(head.next_cursor.as_deref(), Some(head.items[499].id.as_str()));
}

#[test]
fn pages_stay_stable_across_inserts_and_removals() {
    let (_dir, conn) = common::open();
    let id = playlist_with(&conn, 10);
    let first = playlists::items_page(&conn, &id, None, 4, None).unwrap();
    let all_before = detail_ids(&conn, &id);
    // Remove an item already served and append a new one while the user scrolls.
    playlists::remove_items(&conn, &id, std::slice::from_ref(&first.items[1].id), 4).unwrap();
    playlists::add_tracks(&conn, &id, vec![snapshot(99)], 5).unwrap();
    let cursor = first.next_cursor.clone().unwrap();
    let (rest, _) = {
        let mut ids = Vec::new();
        let mut cursor = Some(cursor);
        while let Some(c) = cursor {
            let page = playlists::items_page(&conn, &id, Some(&c), 4, None).unwrap();
            ids.extend(page.items.iter().map(|i| i.id.clone()));
            cursor = page.next_cursor;
        }
        (ids, ())
    };
    assert_eq!(rest[..6], all_before[4..], "no item skipped or repeated");
    assert_eq!(rest.len(), 7, "the appended item arrives at the end");

    playlists::remove_items(&conn, &id, std::slice::from_ref(&first.items[3].id), 6).unwrap();
    let gone = playlists::items_page(&conn, &id, first.next_cursor.as_deref(), 4, None);
    assert!(matches!(gone, Err(StoreError::Conflict(_))), "a removed cursor item asks for a reload");
}

#[test]
fn the_filter_ignores_case_in_any_script() {
    let (_dir, conn) = common::open();
    let id = playlist_with(&conn, 100);
    let (ids, totals) = walk(&conn, &id, 3, Some("  КИНО "));
    assert_eq!(ids.len(), 20, "every fifth title");
    assert!(totals.iter().all(|t| *t == 20));
    let (by_artist, _) = walk(&conn, &id, 50, Some("artist 16"));
    assert_eq!(by_artist.len(), 5);
    let (by_album, _) = walk(&conn, &id, 50, Some("album 12"));
    assert!(!by_album.is_empty());
    assert_eq!(walk(&conn, &id, 50, Some("")).0.len(), 100, "a blank filter is no filter");
    assert_eq!(playlists::items_page(&conn, &id, None, 50, Some("nothing like this")).unwrap().total, 0);
}

/// `cargo test --release -p nuvo-store --test paging -- --nocapture` checks the paging budget.
#[cfg(not(debug_assertions))]
#[test]
fn a_page_of_ten_thousand_costs_under_20_ms_in_release() {
    let (_dir, conn) = common::open();
    let id = playlist_with(&conn, 10_000);
    sort(&conn, &id, "title", false);
    let mut cursor = None;
    let mut slowest = std::time::Duration::ZERO;
    for _ in 0..20 {
        let started = std::time::Instant::now();
        let page = playlists::items_page(&conn, &id, cursor.as_deref(), 500, None).unwrap();
        slowest = slowest.max(started.elapsed());
        cursor = page.next_cursor;
    }
    println!("slowest page: {slowest:?}");
    assert!(slowest < std::time::Duration::from_millis(20), "slowest page took {slowest:?}");
}
