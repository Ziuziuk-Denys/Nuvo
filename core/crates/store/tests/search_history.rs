mod common;

use nuvo_contracts::AddSearch;
use nuvo_store::{StoreError, search_history};
use serde_json::json;

fn query(text: &str) -> AddSearch {
    AddSearch { kind: "query".into(), query: Some(text.into()), item: None }
}

fn picked(kind: &str, id: &str) -> AddSearch {
    AddSearch { kind: kind.into(), query: Some("typed".into()), item: Some(json!({"id": id, "title": format!("T {id}"), "subtitle": "S"})) }
}

#[test]
fn queries_and_picks_are_upserted_and_newest_comes_first() {
    let (_dir, conn) = common::open();
    let first = search_history::add(&conn, &query("Daft Punk"), 100).unwrap();
    search_history::add(&conn, &picked("track", "t1"), 100).unwrap();
    let again = search_history::add(&conn, &query("  daft   PUNK "), 100).unwrap();
    assert_eq!(again.id, first.id, "the same query keeps its row");
    assert_eq!(again.query.as_deref(), Some("daft   PUNK"), "the latest spelling is shown");
    search_history::add(&conn, &picked("track", "t1"), 200).unwrap();
    search_history::add(&conn, &picked("artist", "t1"), 300).unwrap();

    let list = search_history::list(&conn, 30).unwrap();
    let keys: Vec<(String, Option<String>)> = list.iter().map(|e| (e.kind.clone(), e.item.as_ref().map(|i| i["id"].as_str().unwrap().to_string()))).collect();
    assert_eq!(keys, [("artist".into(), Some("t1".into())), ("track".into(), Some("t1".into())), ("query".into(), None)]);
    assert_eq!(list[1].item.as_ref().unwrap()["title"], "T t1");
}

#[test]
fn only_the_newest_fifty_are_kept_and_order_holds_within_one_millisecond() {
    let (_dir, conn) = common::open();
    for i in 0..55 {
        search_history::add(&conn, &query(&format!("q{i}")), 1000).unwrap();
    }
    let all = search_history::list(&conn, 500).unwrap();
    assert_eq!(all.len(), search_history::KEEP);
    assert_eq!(all[0].query.as_deref(), Some("q54"));
    assert_eq!(all[49].query.as_deref(), Some("q5"));
    assert_eq!(search_history::list(&conn, 30).unwrap().len(), 30);
}

#[test]
fn delete_one_and_clear() {
    let (_dir, conn) = common::open();
    let a = search_history::add(&conn, &query("a"), 1).unwrap();
    search_history::add(&conn, &query("b"), 2).unwrap();
    search_history::delete(&conn, &a.id).unwrap();
    search_history::delete(&conn, &a.id).unwrap();
    assert_eq!(search_history::get(&conn, &a.id).unwrap(), None);
    assert_eq!(search_history::list(&conn, 30).unwrap().len(), 1);
    search_history::clear(&conn).unwrap();
    assert!(search_history::list(&conn, 30).unwrap().is_empty());
}

#[test]
fn bad_entries_are_refused() {
    let (_dir, conn) = common::open();
    let bad = [
        AddSearch { kind: "song".into(), query: Some("x".into()), item: None },
        query("   "),
        query(&"x".repeat(201)),
        AddSearch { kind: "track".into(), query: None, item: None },
        AddSearch { kind: "track".into(), query: None, item: Some(json!({"title": "no id"})) },
        AddSearch { kind: "album".into(), query: None, item: Some(json!({"id": "a", "blob": "x".repeat(9000)})) },
    ];
    for input in bad {
        assert!(matches!(search_history::add(&conn, &input, 1), Err(StoreError::Invalid(_))), "{input:?}");
    }
    assert!(search_history::list(&conn, 30).unwrap().is_empty());
}
