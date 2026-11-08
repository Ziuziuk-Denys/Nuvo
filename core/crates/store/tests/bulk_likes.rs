mod common;

use nuvo_store::{StoreError, library};
use serde_json::json;

#[test]
fn like_many_skips_liked_tracks_and_keeps_the_playlist_order() {
    let (_dir, conn) = common::open();
    library::like(&conn, "b", Some(common::track("b", "X")), 10).unwrap();
    let input = vec![common::track("a", "X"), common::track("b", "X"), json!({"title": "no id"}), common::track("c", "X"), common::track("a", "X")];
    let result = library::like_many(&conn, &input, 1000).unwrap();
    assert_eq!(result.added, ["a", "c"]);
    assert_eq!((result.already_liked, result.rejected), (2, 1), "b was liked before, a repeats");

    let page = library::liked_page(&conn, 10, None).unwrap();
    let order: Vec<&str> = page.items.iter().map(|i| i.track["id"].as_str().unwrap()).collect();
    assert_eq!(order, ["a", "c", "b"], "the first track of the request is the newest like");
}

#[test]
fn undo_unlikes_only_what_the_request_added() {
    let (_dir, conn) = common::open();
    library::like(&conn, "kept", Some(common::track("kept", "X")), 10).unwrap();
    let result = library::like_many(&conn, &[common::track("kept", "X"), common::track("new", "X")], 20).unwrap();
    assert_eq!(library::unlike_many(&conn, &result.added).unwrap(), 1);
    assert!(library::is_liked(&conn, "kept").unwrap());
    assert!(!library::is_liked(&conn, "new").unwrap());
}

#[test]
fn requests_are_capped_at_five_thousand() {
    let (_dir, conn) = common::open();
    let many: Vec<_> = (0..5001).map(|i| common::track(&format!("t{i}"), "X")).collect();
    assert!(matches!(library::like_many(&conn, &many, 1), Err(StoreError::Invalid(_))));
    assert_eq!(library::like_many(&conn, &many[..5000], 1).unwrap().added.len(), 5000);
    let ids: Vec<String> = (0..5001).map(|i| format!("t{i}")).collect();
    assert!(matches!(library::unlike_many(&conn, &ids), Err(StoreError::Invalid(_))));
}
