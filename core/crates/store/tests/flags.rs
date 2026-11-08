mod common;

use nuvo_contracts::{CreatePlaylist, FlagKey, SetFlag};
use nuvo_store::{StoreError, flags, playlists};
use serde_json::json;

fn pin() -> SetFlag {
    SetFlag { pinned: Some(true), ..Default::default() }
}

fn key(kind: &str, id: &str) -> FlagKey {
    FlagKey { kind: kind.into(), id: id.into() }
}

fn order(conn: &nuvo_store::Connection) -> Vec<(String, String, bool, bool)> {
    flags::list(conn).unwrap().into_iter().map(|f| (f.kind, f.id, f.pinned, f.hidden)).collect()
}

#[test]
fn pins_have_no_cap_and_keep_their_order() {
    let (_dir, conn) = common::open();
    for i in 0..9 {
        flags::set(&conn, "album", &format!("a{i}"), &pin(), i).unwrap();
    }
    let all = flags::list(&conn).unwrap();
    assert_eq!(all.len(), 9);
    assert!(all.iter().all(|f| f.pinned));
    assert_eq!(all.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);

    flags::set(&conn, "album", "a0", &pin(), 99).unwrap();
    assert_eq!(flags::list(&conn).unwrap()[0].id, "a0", "pinning again keeps the place");

    let reordered = flags::pin_order(&conn, &[key("album", "a8"), key("album", "a3")]).unwrap();
    let ids: Vec<&str> = reordered.iter().map(|f| f.id.as_str()).collect();
    assert_eq!(ids, ["a8", "a3", "a0", "a1", "a2", "a4", "a5", "a6", "a7"]);
}

#[test]
fn hide_unpins_pin_unhides_and_an_empty_row_disappears() {
    let (_dir, conn) = common::open();
    let snapshot = json!({"title": "Discovery", "cover": {"url": "https://img/d.jpg"}});
    flags::set(&conn, "album", "d", &SetFlag { pinned: Some(true), snapshot: Some(snapshot.clone()), ..Default::default() }, 1).unwrap();
    let hidden = flags::set(&conn, "album", "d", &SetFlag { hidden: Some(true), ..Default::default() }, 2).unwrap();
    assert_eq!((hidden.pinned, hidden.hidden), (false, true));
    assert_eq!(hidden.snapshot, Some(snapshot), "the snapshot stays for the Hidden filter");

    let shown = flags::set(&conn, "album", "d", &pin(), 3).unwrap();
    assert_eq!((shown.pinned, shown.hidden), (true, false));

    let cleared = flags::set(&conn, "album", "d", &SetFlag { pinned: Some(false), ..Default::default() }, 4).unwrap();
    assert_eq!((cleared.pinned, cleared.hidden), (false, false));
    assert!(flags::list(&conn).unwrap().is_empty(), "neither pinned nor hidden: no row");

    flags::set(&conn, "artist", "x", &SetFlag { hidden: Some(true), ..Default::default() }, 5).unwrap();
    flags::set(&conn, "playlist", "p", &pin(), 6).unwrap();
    assert_eq!(order(&conn), [("playlist".into(), "p".into(), true, false), ("artist".into(), "x".into(), false, true)]);
    flags::delete(&conn, "artist", "x").unwrap();
    assert_eq!(order(&conn).len(), 1);
}

#[test]
fn deleting_an_own_playlist_drops_its_flags() {
    let (_dir, conn) = common::open();
    let own = playlists::create(&conn, &CreatePlaylist { title: "Mine".into(), description: None, is_public: false }, 1).unwrap();
    flags::set(&conn, "playlist", &own.id, &pin(), 2).unwrap();
    flags::set(&conn, "album", &own.id, &pin(), 3).unwrap();
    playlists::delete(&conn, &own.id).unwrap();
    assert_eq!(order(&conn), [("album".into(), own.id.clone(), true, false)], "only the playlist flag goes");
}

#[test]
fn bad_input_is_refused_and_changes_nothing() {
    let (_dir, conn) = common::open();
    flags::set(&conn, "album", "a", &pin(), 1).unwrap();
    let bad = [
        ("song", "a", pin()),
        ("album", "", pin()),
        ("album", "a", SetFlag { pinned: Some(true), hidden: Some(true), snapshot: None }),
        ("album", "a", SetFlag { snapshot: Some(json!("text")), ..Default::default() }),
        ("album", "a", SetFlag { snapshot: Some(json!({"title": "x".repeat(17_000)})), ..Default::default() }),
    ];
    for (kind, id, input) in bad {
        assert!(matches!(flags::set(&conn, kind, id, &input, 2), Err(StoreError::Invalid(_))), "{kind} {id:?} {input:?}");
    }
    assert!(matches!(flags::pin_order(&conn, &[key("album", "nope")]), Err(StoreError::Invalid(_))));
    assert!(matches!(flags::pin_order(&conn, &[key("album", "a"), key("album", "a")]), Err(StoreError::Invalid(_))));
    assert_eq!(order(&conn), [("album".into(), "a".into(), true, false)]);
}
