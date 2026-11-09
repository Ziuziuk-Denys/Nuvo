mod common;

use nuvo_contracts::{CreatePlaylist, InsertItem, TransferMode, UpdatePlaylist};
use nuvo_store::cache_index::{self, CacheEntry};
use nuvo_store::{StoreError, library, playlists};
use serde_json::json;

fn create(conn: &nuvo_store::Connection, title: &str) -> String {
    let input = CreatePlaylist { title: title.into(), description: None, is_public: false };
    playlists::create(conn, &input, 1000).unwrap().id
}

fn order(conn: &nuvo_store::Connection, pid: &str) -> Vec<String> {
    playlists::get(conn, pid).unwrap().items.iter().map(|i| i.track["id"].as_str().unwrap().to_string()).collect()
}

#[test]
fn create_update_list_delete() {
    let (_dir, conn) = common::open();
    let id = create(&conn, "  Road  ");
    let p = playlists::get(&conn, &id).unwrap().playlist;
    assert_eq!((p.title.as_str(), p.revision, p.owner_id), ("Road", 1, "local"));

    let patch = UpdatePlaylist { description: Some(Some("d".into())), pinned_offline: Some(true), ..Default::default() };
    let p = playlists::update(&conn, &id, &patch, 2000).unwrap();
    assert_eq!(p.description.as_deref(), Some("d"));
    assert!(p.pinned_offline);
    let cleared = UpdatePlaylist { description: Some(None), ..Default::default() };
    assert_eq!(playlists::update(&conn, &id, &cleared, 3000).unwrap().description, None);

    assert_eq!(playlists::list(&conn).unwrap().len(), 1);
    playlists::delete(&conn, &id).unwrap();
    assert!(matches!(playlists::get(&conn, &id).unwrap_err(), StoreError::NotFound("playlist")));
}

#[test]
fn blank_titles_are_rejected() {
    let (_dir, conn) = common::open();
    let input = CreatePlaylist { title: "   ".into(), description: None, is_public: false };
    assert!(matches!(playlists::create(&conn, &input, 1).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn adding_appends_bumps_revision_and_rejects_duplicates_with_conflict() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    playlists::add_track(&conn, &pid, "a", Some(common::track("a", "X")), 2000).unwrap();
    playlists::add_track(&conn, &pid, "b", Some(common::track("b", "X")), 2001).unwrap();
    assert_eq!(order(&conn, &pid), ["a", "b"]);
    assert_eq!(playlists::get(&conn, &pid).unwrap().playlist.revision, 3);
    let err = playlists::add_track(&conn, &pid, "a", None, 2002).unwrap_err();
    assert!(matches!(err, StoreError::Conflict(_)), "renderer treats 409 as already added");
    assert!(matches!(playlists::add_track(&conn, "missing", "a", None, 1).unwrap_err(), StoreError::NotFound("playlist")));
}

#[test]
fn items_carry_the_liked_flag() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    playlists::add_track(&conn, &pid, "a", Some(common::track("a", "X")), 2000).unwrap();
    library::like(&conn, "a", None, 2001).unwrap();
    assert_eq!(playlists::get(&conn, &pid).unwrap().items[0].track["viewer"]["liked"], true);
}

#[test]
fn bulk_add_counts_added_and_rejected_and_skips_duplicates() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    playlists::add_track(&conn, &pid, "a", Some(common::track("a", "X")), 2000).unwrap();
    let batch = vec![common::track("a", "X"), common::track("b", "X"), json!({"title": "no id"}), common::track("b", "X"), common::track("c", "X")];
    let result = playlists::add_tracks(&conn, &pid, batch, 3000).unwrap();
    assert_eq!((result.added, result.rejected), (2, 1));
    assert_eq!(order(&conn, &pid), ["a", "b", "c"]);
}

#[test]
fn move_reorders_and_rejects_a_stale_revision() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    for id in ["a", "b", "c"] {
        playlists::add_track(&conn, &pid, id, Some(common::track(id, "X")), 2000).unwrap();
    }
    let view = playlists::get(&conn, &pid).unwrap();
    let item = |i: usize| view.items[i].id.clone();

    let moved = playlists::move_item(&conn, &pid, &item(2), Some(&item(0)), view.playlist.revision, 3000).unwrap();
    assert_eq!(moved.items.iter().map(|i| i.track["id"].as_str().unwrap()).collect::<Vec<_>>(), ["c", "a", "b"]);

    let stale = playlists::move_item(&conn, &pid, &item(0), None, view.playlist.revision, 3001).unwrap_err();
    assert!(matches!(stale, StoreError::Conflict(_)));

    let to_end = playlists::move_item(&conn, &pid, &item(2), None, moved.playlist.revision, 3002).unwrap();
    assert_eq!(to_end.items.iter().map(|i| i.track["id"].as_str().unwrap()).collect::<Vec<_>>(), ["a", "b", "c"]);
}

#[test]
fn repeated_moves_into_the_same_gap_stay_ordered() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    for id in ["a", "b", "c"] {
        playlists::add_track(&conn, &pid, id, Some(common::track(id, "X")), 2000).unwrap();
    }
    for round in 0..80 {
        let view = playlists::get(&conn, &pid).unwrap();
        let ids: Vec<_> = view.items.iter().map(|i| i.id.clone()).collect();
        playlists::move_item(&conn, &pid, &ids[2], Some(&ids[1]), view.playlist.revision, 3000 + round).unwrap();
    }
    let positions: Vec<f64> = playlists::get(&conn, &pid).unwrap().items.iter().map(|i| i.position).collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "positions must stay strictly increasing: {positions:?}");
}

#[test]
fn remove_item_and_cascade_on_delete() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    let item = playlists::add_track(&conn, &pid, "a", Some(common::track("a", "X")), 2000).unwrap();
    playlists::remove_item(&conn, &pid, &item.id, 2001).unwrap();
    assert!(order(&conn, &pid).is_empty());
    assert!(matches!(playlists::remove_item(&conn, &pid, &item.id, 2002).unwrap_err(), StoreError::NotFound(_)));
    playlists::add_track(&conn, &pid, "a", None, 2003).unwrap();
    playlists::delete(&conn, &pid).unwrap();
    let left: i64 = conn.query_row("SELECT count(*) FROM playlist_items", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

fn song(id: &str, title: &str, artist: &str, album: Option<&str>, duration_ms: i64) -> serde_json::Value {
    let mut track = json!({"id": id, "title": title, "artists": [{"id": artist, "name": artist}], "durationMs": duration_ms});
    if let Some(album) = album {
        track["album"] = json!({"id": album, "title": album});
    }
    track
}

#[test]
fn sort_modes_are_stored_and_stable_by_position() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    playlists::add_track(&conn, &pid, "a", Some(song("a", "beta", "Zed", Some("Mid"), 300_000)), 2000).unwrap();
    playlists::add_track(&conn, &pid, "b", Some(song("b", "Alpha", "amy", None, 100_000)), 2001).unwrap();
    playlists::add_track(&conn, &pid, "c", Some(song("c", "alpha", "Bob", Some("End"), 200_000)), 2002).unwrap();
    let revision = playlists::get(&conn, &pid).unwrap().playlist.revision;

    let cases = [
        ("manual", false, ["a", "b", "c"]),
        ("title", false, ["b", "c", "a"]),
        ("title", true, ["a", "b", "c"]),
        ("artist", false, ["b", "c", "a"]),
        ("album", false, ["c", "a", "b"]),
        ("album", true, ["a", "c", "b"]),
        ("duration", false, ["b", "c", "a"]),
        ("duration", true, ["a", "c", "b"]),
        ("added", true, ["c", "b", "a"]),
    ];
    for (mode, desc, expected) in cases {
        let patch = UpdatePlaylist { sort_mode: Some(mode.into()), sort_desc: Some(desc), ..Default::default() };
        let p = playlists::update(&conn, &pid, &patch, 3000).unwrap();
        assert_eq!((p.sort_mode.as_str(), p.sort_desc), (mode, desc));
        assert_eq!(order(&conn, &pid), expected, "{mode} desc={desc}");
    }
    let p = playlists::get(&conn, &pid).unwrap().playlist;
    assert_eq!((p.sort_mode.as_str(), p.sort_desc, p.revision), ("added", true, revision), "sorting is not an item change");

    let bad = UpdatePlaylist { sort_mode: Some("random".into()), ..Default::default() };
    assert!(matches!(playlists::update(&conn, &pid, &bad, 4000).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn covers_set_replace_remove_and_cascade() {
    let (_dir, conn) = common::open();
    let pid = create(&conn, "P");
    assert_eq!(playlists::get(&conn, &pid).unwrap().playlist.cover_url, None);

    let p = playlists::set_cover(&conn, &pid, "image/webp", b"first", 5000).unwrap();
    assert_eq!(p.cover_url.as_deref(), Some(format!("nuvo-core://local/v1/me/playlists/{pid}/cover?v=5000").as_str()));
    let p = playlists::set_cover(&conn, &pid, "image/png", b"second", 6000).unwrap();
    assert!(p.cover_url.unwrap().ends_with("?v=6000"));
    assert_eq!(playlists::list(&conn).unwrap()[0].updated_at, "1970-01-01T00:00:06.000Z");
    assert_eq!(playlists::cover(&conn, &pid).unwrap(), Some(("image/png".to_string(), b"second".to_vec())));

    assert_eq!(playlists::delete_cover(&conn, &pid, 7000).unwrap().cover_url, None);
    assert_eq!(playlists::cover(&conn, &pid).unwrap(), None);
    assert!(matches!(playlists::set_cover(&conn, "missing", "image/png", b"x", 1).unwrap_err(), StoreError::NotFound("playlist")));

    playlists::set_cover(&conn, &pid, "image/webp", b"again", 8000).unwrap();
    playlists::delete(&conn, &pid).unwrap();
    let left: i64 = conn.query_row("SELECT count(*) FROM playlist_covers", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0, "deleting the playlist deletes its cover");
}

fn filled(conn: &nuvo_store::Connection, title: &str, ids: &[&str]) -> String {
    let pid = create(conn, title);
    for (n, id) in ids.iter().enumerate() {
        playlists::add_track(conn, &pid, id, Some(common::track(id, "X")), 2000 + n as i64).unwrap();
    }
    pid
}

fn item_ids(conn: &nuvo_store::Connection, pid: &str, tracks: &[&str]) -> Vec<String> {
    let items = playlists::get(conn, pid).unwrap().items;
    tracks.iter().map(|t| items.iter().find(|i| i.track["id"] == *t).unwrap().id.clone()).collect()
}

#[test]
fn bulk_remove_ignores_unknown_ids_and_bumps_once() {
    let (_dir, conn) = common::open();
    let pid = filled(&conn, "P", &["a", "b", "c", "d"]);
    let before = playlists::get(&conn, &pid).unwrap().playlist.revision;
    let mut ids = item_ids(&conn, &pid, &["b", "d"]);
    ids.push("not-an-item".into());
    let result = playlists::remove_items(&conn, &pid, &ids, 3000).unwrap();
    assert_eq!((result.removed, result.revision), (2, before + 1));
    assert_eq!(order(&conn, &pid), ["a", "c"]);

    let again = playlists::remove_items(&conn, &pid, &ids, 3001).unwrap();
    assert_eq!((again.removed, again.revision), (0, before + 1), "nothing removed, revision unchanged");
    assert!(matches!(playlists::remove_items(&conn, "missing", &ids, 1).unwrap_err(), StoreError::NotFound("playlist")));
}

#[test]
fn transfer_copy_skips_tracks_the_target_has() {
    let (_dir, conn) = common::open();
    let source = filled(&conn, "S", &["a", "b", "c"]);
    let target = filled(&conn, "T", &["b"]);
    let target_rev = playlists::get(&conn, &target).unwrap().playlist.revision;
    let source_rev = playlists::get(&conn, &source).unwrap().playlist.revision;

    let ids = item_ids(&conn, &source, &["c", "b", "a"]);
    let result = playlists::transfer_items(&conn, &source, &ids, &target, TransferMode::Copy, 3000).unwrap();
    assert_eq!((result.skipped, result.removed), (1, 0));
    assert_eq!(result.added.iter().map(|i| i.track["id"].as_str().unwrap()).collect::<Vec<_>>(), ["a", "c"], "manual order of the source");
    assert_eq!((result.source_revision, result.target_revision), (source_rev, target_rev + 1));
    assert_eq!(order(&conn, &source), ["a", "b", "c"]);
    assert_eq!(order(&conn, &target), ["b", "a", "c"]);
}

#[test]
fn transfer_move_removes_every_selected_item_from_the_source() {
    let (_dir, conn) = common::open();
    let source = filled(&conn, "S", &["a", "b", "c"]);
    let target = filled(&conn, "T", &["b"]);
    let ids = item_ids(&conn, &source, &["a", "b"]);
    let result = playlists::transfer_items(&conn, &source, &ids, &target, TransferMode::Move, 3000).unwrap();
    assert_eq!((result.added.len(), result.skipped, result.removed), (1, 1, 2));
    assert_eq!(order(&conn, &source), ["c"]);
    assert_eq!(order(&conn, &target), ["b", "a"]);

    assert!(matches!(playlists::transfer_items(&conn, &source, &ids, &source, TransferMode::Move, 1).unwrap_err(), StoreError::Invalid(_)));
    assert!(matches!(playlists::transfer_items(&conn, &source, &ids, "missing", TransferMode::Copy, 1).unwrap_err(), StoreError::NotFound("playlist")));
}

#[test]
fn insert_restores_removed_items_in_place() {
    let (_dir, conn) = common::open();
    let pid = filled(&conn, "P", &["a", "b", "c", "d"]);
    let removed: Vec<InsertItem> = playlists::get(&conn, &pid)
        .unwrap()
        .items
        .iter()
        .filter(|i| i.track["id"] == "b" || i.track["id"] == "d")
        .map(|i| InsertItem { track_id: i.track["id"].as_str().unwrap().into(), position: i.position, added_at: i.added_at.clone() })
        .collect();
    let ids = item_ids(&conn, &pid, &["b", "d"]);
    playlists::remove_items(&conn, &pid, &ids, 3000).unwrap();
    let revision = playlists::get(&conn, &pid).unwrap().playlist.revision;

    let result = playlists::insert_items(&conn, &pid, &removed, 4000).unwrap();
    assert_eq!((result.added, result.rejected), (2, 0));
    assert_eq!(order(&conn, &pid), ["a", "b", "c", "d"]);
    let restored = playlists::get(&conn, &pid).unwrap();
    assert_eq!(restored.playlist.revision, revision + 1);
    assert_eq!(restored.items[1].added_at, removed[0].added_at, "date added survives undo");

    let again = playlists::insert_items(&conn, &pid, &removed, 5000).unwrap();
    assert_eq!(again.added, 0, "tracks already present are skipped");
    let unknown = [InsertItem { track_id: "never-seen".into(), position: 1.5, added_at: "2024-01-01T00:00:00.000Z".into() }];
    assert_eq!(playlists::insert_items(&conn, &pid, &unknown, 5000).unwrap().rejected, 1);
    let bad = [InsertItem { track_id: "a".into(), position: 1.0, added_at: "yesterday".into() }];
    assert!(matches!(playlists::insert_items(&conn, &pid, &bad, 5000).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn offline_progress_counts_cached_tracks() {
    let (_dir, conn) = common::open();
    let pid = filled(&conn, "P", &["a", "b", "c"]);
    assert_eq!(playlists::offline_progress(&conn, &pid).unwrap(), nuvo_contracts::OfflineProgress { cached: 0, total: 3 });
    for id in ["a", "c", "elsewhere"] {
        let entry = CacheEntry { track_id: id.into(), path: format!("/c/{id}"), size_bytes: 1, mime: "audio/webm".into(), codec: None };
        cache_index::upsert(&conn, &entry, 1).unwrap();
    }
    assert_eq!(playlists::offline_progress(&conn, &pid).unwrap(), nuvo_contracts::OfflineProgress { cached: 2, total: 3 });
    assert!(matches!(playlists::offline_progress(&conn, "missing").unwrap_err(), StoreError::NotFound("playlist")));
}

#[test]
fn list_with_covers_counts_items_and_keeps_four_distinct_covers_in_order() {
    let (_dir, conn) = common::open();
    let mix = create(&conn, "Mix");
    for (i, letter) in ["A", "A", "B", "C", "D", "E"].iter().enumerate() {
        let id = format!("t{i}");
        let mut track = common::track(&id, "X");
        track["cover"]["url"] = json!(format!("https://img/{letter}.jpg"));
        playlists::add_track(&conn, &mix, &id, Some(track), 10 + i as i64).unwrap();
    }
    let empty = create(&conn, "Empty");
    let list = playlists::list_with_covers(&conn).unwrap();
    let full = list.iter().find(|item| item.playlist.id == mix).unwrap();
    assert_eq!(full.track_count, 6);
    assert_eq!(full.covers, vec!["https://img/A.jpg", "https://img/B.jpg", "https://img/C.jpg", "https://img/D.jpg"]);
    let none = list.iter().find(|item| item.playlist.id == empty).unwrap();
    assert_eq!((none.track_count, none.covers.len()), (0, 0));
}

#[test]
fn list_with_covers_after_the_custom_cover_is_deleted_still_shows_track_covers() {
    let (_dir, conn) = common::open();
    let mix = create(&conn, "Mix");
    let other = create(&conn, "Other");
    for (pid, prefix) in [(&mix, "m"), (&other, "o")] {
        for (i, letter) in ["A", "B", "A", "C", "D", "E", "F"].iter().enumerate() {
            let id = format!("{prefix}{i}");
            let mut track = common::track(&id, "X");
            track["cover"]["url"] = json!(format!("https://img/{prefix}{letter}.jpg"));
            playlists::add_track(&conn, pid, &id, Some(track), 10 + i as i64).unwrap();
        }
    }
    playlists::set_cover(&conn, &mix, "image/webp", b"custom", 5000).unwrap();
    playlists::delete_cover(&conn, &mix, 6000).unwrap();
    let list = playlists::list_with_covers(&conn).unwrap();
    let item = list.iter().find(|item| item.playlist.id == mix).unwrap();
    assert_eq!(item.playlist.cover_url, None);
    assert_eq!(item.track_count, 7);
    assert_eq!(item.covers, vec!["https://img/mA.jpg", "https://img/mB.jpg", "https://img/mC.jpg", "https://img/mD.jpg"]);
    let item = list.iter().find(|item| item.playlist.id == other).unwrap();
    assert_eq!(item.covers, vec!["https://img/oA.jpg", "https://img/oB.jpg", "https://img/oC.jpg", "https://img/oD.jpg"]);
}
