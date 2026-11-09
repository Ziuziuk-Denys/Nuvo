mod common;

use common::{api, setup, user};
use nuvo_net::fixture::Reply;
use nuvo_soundcloud::{ScError, import_row, strip_artist};
use serde_json::{Value, json};

fn published(id: u64) -> Value {
    json!({
        "id": id, "kind": "track", "title": "Mira Holt - Paper Moons", "duration": 201000,
        "artwork_url": null,
        "user": {"id": 9, "username": "nightowl", "avatar_url": "https://i1.sndcdn.com/avatars-9-large.jpg"},
        "publisher_metadata": {"artist": "Mira Holt", "release_title": "Harbour"}
    })
}

#[test]
fn a_leading_artist_name_is_dropped_only_when_it_names_the_artist() {
    assert_eq!(strip_artist("Mira Holt - Paper Moons", "mira holt"), "Paper Moons");
    assert_eq!(strip_artist("Tomas Vey - Paper Moons", "Mira Holt"), "Tomas Vey - Paper Moons");
    assert_eq!(strip_artist("Mira Holt - ", "Mira Holt"), "Mira Holt -");
}

#[test]
fn rows_use_the_publisher_artist_release_and_the_set_artwork() {
    let row = import_row(&published(42), Some("https://i1.sndcdn.com/artworks-set-large.jpg")).unwrap();
    assert_eq!(row["title"], "Paper Moons");
    assert_eq!(row["artists"], json!(["Mira Holt"]));
    assert_eq!(row["album"], "Harbour");
    assert_eq!(row["durationMs"], 201000);
    assert_eq!(row["track"]["id"], "sc:42");
    assert_eq!(row["track"]["title"], "Paper Moons");
    assert_eq!(row["track"]["artists"], json!([{"id": "sc_user_9", "name": "Mira Holt"}]));
    assert_eq!(row["track"]["cover"]["url"], "https://i1.sndcdn.com/artworks-set-t500x500.jpg");
}

#[test]
fn without_publisher_data_the_uploader_and_avatar_are_used() {
    let record = json!({"id": 5, "kind": "track", "title": "Late", "duration": 0, "user": user(9, "nightowl")});
    let row = import_row(&record, None).unwrap();
    assert_eq!(row["artists"], json!(["nightowl"]));
    assert!(row.get("album").is_none() && row.get("durationMs").is_none());
    assert_eq!(row["track"]["cover"]["url"], "https://i1.sndcdn.com/avatars-9-t500x500.jpg");
    assert!(import_row(&json!({"id": 6, "kind": "track", "title": "  "}), None).is_none());
}

#[tokio::test]
async fn a_set_link_lists_every_track_in_set_order() {
    let (fx, sc) = setup().await;
    fx.on(&api("resolve"), Reply::json(json!({"id": 77, "kind": "playlist", "title": "Late drive"})));
    fx.on(
        &api("playlists/77"),
        Reply::json(json!({"id": 77, "kind": "playlist", "title": "Late drive", "artwork_url": "https://i1.sndcdn.com/artworks-set-large.jpg", "user": user(9, "nightowl"), "tracks": [published(1), published(2)]})),
    );
    let listing = sc.import_listing("https://soundcloud.com/nightowl/sets/late-drive?si=x").await.unwrap();
    assert_eq!(listing.label, "Late drive");
    assert_eq!(listing.likes_of, None);
    assert_eq!(listing.rows.iter().map(|r| r["track"]["id"].as_str().unwrap()).collect::<Vec<_>>(), ["sc:1", "sc:2"]);
    assert_eq!(listing.rows[0]["track"]["cover"]["url"], "https://i1.sndcdn.com/artworks-set-t500x500.jpg");
    assert_eq!(fx.hits(&api("resolve"))[0].query["url"], "https://soundcloud.com/nightowl/sets/late-drive");
}

#[tokio::test]
async fn a_likes_link_walks_the_likes_pages() {
    let (fx, sc) = setup().await;
    fx.on(&api("resolve"), Reply::json(user(9, "nightowl")));
    fx.on(&api("users/9/likes"), Reply::json(json!({"collection": [{"track": published(1)}, published(2)], "next_href": null})));
    let listing = sc.import_listing("soundcloud.com/nightowl/likes").await.unwrap();
    assert_eq!((listing.label.as_str(), listing.likes_of.as_deref()), ("nightowl", Some("nightowl")));
    assert_eq!(listing.rows.len(), 2);
    assert_eq!(fx.hits(&api("resolve"))[0].query["url"], "https://soundcloud.com/nightowl");
}

#[tokio::test]
async fn a_short_link_is_followed_and_loses_its_query() {
    let (fx, sc) = setup().await;
    fx.on("https://on.soundcloud.com/AbC", Reply::redirect("https://soundcloud.com/nightowl/paper-moons?utm_source=x"));
    fx.on("https://soundcloud.com/nightowl/paper-moons", Reply::text("<html></html>"));
    fx.on(&api("resolve"), Reply::json(published(42)));
    let listing = sc.import_listing("https://on.soundcloud.com/AbC").await.unwrap();
    assert_eq!(fx.hits(&api("resolve"))[0].query["url"], "https://soundcloud.com/nightowl/paper-moons");
    assert_eq!(listing.label, "Paper Moons");
    assert_eq!(listing.rows.len(), 1);
}

#[tokio::test]
async fn links_that_are_not_tracks_sets_or_likes_are_invalid() {
    let (fx, sc) = setup().await;
    fx.on("https://on.soundcloud.com/Dead", Reply::redirect("https://evil.example/x"));
    assert!(matches!(sc.import_listing("https://on.soundcloud.com/Dead").await, Err(ScError::Invalid(_))));
    assert!(matches!(sc.import_listing("https://example.org/a").await, Err(ScError::Invalid(_))));
    fx.on(&api("resolve"), Reply::json(user(9, "nightowl")));
    assert!(matches!(sc.import_listing("https://soundcloud.com/nightowl").await, Err(ScError::Invalid(_))));
}

#[tokio::test]
async fn a_failing_likes_page_keeps_the_rows_read_so_far() {
    let (fx, sc) = setup().await;
    fx.on(&api("resolve"), Reply::json(user(9, "nightowl")));
    let first = Reply::json(json!({"collection": [{"track": published(1)}, published(2)], "next_href": api("users/9/likes?cursor=x")}));
    fx.on_seq(&api("users/9/likes"), vec![first, Reply::status(500)]);
    let listing = sc.import_listing("soundcloud.com/nightowl/likes").await.unwrap();
    assert_eq!((listing.rows.len(), listing.partial), (2, true));
}

#[tokio::test]
async fn a_failing_first_likes_page_is_still_an_error() {
    let (fx, sc) = setup().await;
    fx.on(&api("resolve"), Reply::json(user(9, "nightowl")));
    fx.on(&api("users/9/likes"), Reply::status(500));
    assert!(sc.import_listing("soundcloud.com/nightowl/likes").await.is_err());
}

#[tokio::test]
async fn likes_beyond_the_old_twenty_pages_are_read() {
    let (fx, sc) = setup().await;
    fx.on(&api("resolve"), Reply::json(user(9, "nightowl")));
    let url = api("users/9/likes");
    fx.on_fn(&url, move |hit| {
        let n: u64 = hit.query.get("cursor").and_then(|c| c.parse().ok()).unwrap_or(1);
        let next = (n < 25).then(|| api(&format!("users/9/likes?cursor={}", n + 1)));
        Reply::json(json!({"collection": [{"track": published(n)}], "next_href": next}))
    });
    let listing = sc.import_listing("soundcloud.com/nightowl/likes").await.unwrap();
    assert_eq!((listing.rows.len(), listing.partial), (25, false));
}
