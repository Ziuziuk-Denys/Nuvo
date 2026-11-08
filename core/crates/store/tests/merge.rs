mod common;

use nuvo_contracts::{CreatePlaylist, MergePlaylists, SetFlag, UpdatePlaylist};
use nuvo_store::{Connection, StoreError, flags, playlists};
use serde_json::Value;

fn playlist(conn: &Connection, title: &str, track_ids: &[&str]) -> String {
    let id = playlists::create(conn, &CreatePlaylist { title: title.into(), description: Some(format!("about {title}")), is_public: false }, 1).unwrap().id;
    let tracks: Vec<Value> = track_ids.iter().map(|t| common::track(t, "X")).collect();
    playlists::add_tracks(conn, &id, tracks, 2).unwrap();
    id
}

fn track_ids(conn: &Connection, id: &str) -> Vec<String> {
    playlists::get(conn, id).unwrap().items.into_iter().map(|i| i.track["id"].as_str().unwrap().to_string()).collect()
}

fn merge(sources: &[&str], skip: bool, delete: bool) -> MergePlaylists {
    MergePlaylists { source_ids: sources.iter().map(|s| s.to_string()).collect(), skip_duplicates: skip, delete_sources: delete }
}

#[test]
fn sources_append_in_order_and_duplicates_are_skipped() {
    let (_dir, conn) = common::open();
    let target = playlist(&conn, "Target", &["a", "b"]);
    let one = playlist(&conn, "One", &["c", "a", "d"]);
    let two = playlist(&conn, "Two", &["d", "e", "c"]);
    let before = playlists::get(&conn, &target).unwrap().playlist.revision;
    let result = playlists::merge(&conn, &target, &merge(&[&one, &two, &one], true, false), 10).unwrap();
    assert_eq!((result.added, result.skipped), (3, 3), "a is in the target; d and c were appended from One");
    assert_eq!(track_ids(&conn, &target), ["a", "b", "c", "d", "e"]);
    assert_eq!(result.revision, before + 1, "one bump for the whole merge");
    assert!(result.snapshots.is_empty() && result.deleted_source_ids.is_empty());
    assert_eq!(track_ids(&conn, &one), ["c", "a", "d"], "sources stay unless asked");

    let all = playlists::merge(&conn, &target, &merge(&[&two], false, false), 11).unwrap();
    assert_eq!((all.added, all.skipped), (3, 0), "duplicates are allowed when asked");
}

#[test]
fn delete_and_restore_bring_back_everything() {
    let (_dir, conn) = common::open();
    let target = playlist(&conn, "Target", &["a"]);
    let source = playlist(&conn, "Source", &["b", "c"]);
    playlists::update(&conn, &source, &UpdatePlaylist { sort_mode: Some("title".into()), sort_desc: Some(true), ..Default::default() }, 3).unwrap();
    playlists::set_cover(&conn, &source, "image/png", b"\x89PNG\r\n\x1a\nrest", 4).unwrap();
    flags::set(&conn, "playlist", &source, &SetFlag { pinned: Some(true), ..Default::default() }, 5).unwrap();
    let original = playlists::get(&conn, &source).unwrap();

    let result = playlists::merge(&conn, &target, &merge(&[&source], true, true), 10).unwrap();
    assert_eq!(result.deleted_source_ids, std::slice::from_ref(&source));
    assert!(matches!(playlists::get(&conn, &source), Err(StoreError::NotFound(_))));
    assert!(flags::list(&conn).unwrap().is_empty(), "the deleted playlist's pin goes with it");

    // Undo: remove what was added, then restore the source.
    playlists::remove_items(&conn, &target, &result.added_item_ids, 11).unwrap();
    let restored = playlists::restore(&conn, &result.snapshots, 12).unwrap();
    assert_eq!(restored[0].id, source);
    assert_eq!(track_ids(&conn, &target), ["a"]);
    let back = playlists::get(&conn, &source).unwrap();
    assert_eq!((back.playlist.title.as_str(), back.playlist.description.as_deref()), ("Source", Some("about Source")));
    assert_eq!((back.playlist.sort_mode.as_str(), back.playlist.sort_desc), ("title", true));
    assert_eq!(back.playlist.created_at, original.playlist.created_at);
    assert!(back.playlist.revision > original.playlist.revision);
    let items = |p: &nuvo_contracts::PlaylistWithItems| p.items.iter().map(|i| (i.track["id"].clone(), i.position, i.added_at.clone())).collect::<Vec<_>>();
    assert_eq!(items(&back), items(&original));
    assert_eq!(playlists::cover(&conn, &source).unwrap().unwrap().1, b"\x89PNG\r\n\x1a\nrest");

    assert!(matches!(playlists::restore(&conn, &result.snapshots, 13), Err(StoreError::Conflict(_))), "it exists again");
}

#[test]
fn refusals_change_nothing() {
    let (_dir, conn) = common::open();
    let target = playlist(&conn, "Target", &["a"]);
    let source = playlist(&conn, "Source", &["b"]);
    assert!(matches!(playlists::merge(&conn, &target, &merge(&[&source, &target], true, false), 5), Err(StoreError::Invalid(_))));
    assert!(matches!(playlists::merge(&conn, &target, &merge(&[], true, false), 5), Err(StoreError::Invalid(_))));
    assert!(matches!(playlists::merge(&conn, &target, &merge(&[&source, "missing"], true, true), 5), Err(StoreError::NotFound(_))));
    assert!(matches!(playlists::merge(&conn, "missing", &merge(&[&source], true, false), 5), Err(StoreError::NotFound(_))));
    assert_eq!(track_ids(&conn, &target), ["a"]);
    assert_eq!(track_ids(&conn, &source), ["b"], "the source was not deleted");
}

#[test]
fn twelve_thousand_items_merge_in_one_go() {
    let (_dir, conn) = common::open();
    let target = playlist(&conn, "Target", &[]);
    let ids: Vec<String> = (0..12_000).map(|i| format!("t{i}")).collect();
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    let (left, right) = refs.split_at(6000);
    let one = playlist(&conn, "One", &left[..5000]);
    playlists::add_tracks(&conn, &one, left[5000..].iter().map(|t| common::track(t, "X")).collect(), 3).unwrap();
    let two = playlist(&conn, "Two", &right[..5000]);
    playlists::add_tracks(&conn, &two, right[5000..].iter().map(|t| common::track(t, "X")).collect(), 3).unwrap();
    let result = playlists::merge(&conn, &target, &merge(&[&one, &two], true, true), 10).unwrap();
    assert_eq!((result.added, result.added_item_ids.len()), (12_000, 12_000));
    assert_eq!(track_ids(&conn, &target), ids);
}
