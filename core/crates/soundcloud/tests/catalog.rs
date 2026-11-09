mod common;

use common::{ID_A, api, listing, setup, track, user};
use nuvo_contracts::catalog::SearchResult;
use nuvo_net::fixture::Reply;
use nuvo_soundcloud::{ScError, TypeFilter};
use serde_json::{Value, json};

fn ids_of(tracks: &[nuvo_contracts::catalog::Track]) -> Vec<&str> {
    tracks.iter().map(|t| t.id.as_str()).collect()
}

fn set(id: u64, set_type: &str) -> Value {
    json!({"id": id, "kind": "playlist", "title": format!("Set {id}"), "set_type": set_type, "track_count": 3, "user": user(9, "nightowl")})
}

#[tokio::test]
async fn artist_page_merges_top_tracks_and_uploads() {
    let (fx, sc) = setup().await;
    fx.on(&api("users/9"), Reply::json(json!({"id": 9, "kind": "user", "username": "nightowl-uploads", "full_name": "Night Owl", "verified": true, "description": "from the coast"})));
    fx.on(&api("users/9/toptracks"), Reply::json(listing(vec![track(21, "a", 1), track(20, "b", 1)])));
    fx.on(&api("users/9/tracks"), Reply::json(json!({"collection": [track(20, "b", 1), track(22, "c", 1)], "next_href": api("users/9/tracks?offset=50&limit=50")})));
    fx.on(&api("users/9/albums"), Reply::json(listing(vec![])));
    let page = sc.artist("sc_user_9").await.unwrap();
    assert_eq!(ids_of(&page.tracks), ["sc:21", "sc:20", "sc:22"]);
    assert_eq!((page.name.as_str(), page.bio.as_deref(), page.verified), ("Night Owl", Some("from the coast"), true));
    assert_eq!(page.tracks_next.as_deref(), Some(api("users/9/tracks?offset=50&limit=50").as_str()));
    assert_eq!(page.releases_next, None);
    assert_eq!(fx.hits(&api("users/9/toptracks"))[0].query["limit"], "10");

    fx.on(&api("users/9/tracks"), Reply::json(listing(vec![track(23, "d", 1)])));
    let more = sc.artist_tracks("sc_user_9", page.tracks_next.as_deref().unwrap()).await.unwrap();
    assert_eq!((ids_of(&more.items), more.next), (vec!["sc:23"], None));
    assert_eq!(fx.hits(&api("users/9/tracks")).last().unwrap().query["offset"], "50");
    assert!(matches!(sc.artist_tracks("sc_user_9", "https://api-v2.soundcloud.com/users/8/tracks").await, Err(ScError::Invalid(_))));
    assert!(matches!(sc.artist_releases("sc_user_9", "https://evil.example/users/9/albums").await, Err(ScError::Invalid(_))));
}

#[tokio::test]
async fn release_sets_are_split_into_albums_and_singles() {
    let (fx, sc) = setup().await;
    fx.on(&api("users/9"), Reply::json(user(9, "nightowl")));
    fx.on(&api("users/9/albums"), Reply::json(listing(vec![set(1, "album"), set(2, "ep"), set(3, "single"), set(4, "")])));
    let page = sc.artist("sc_user_9").await.unwrap();
    let ids = |sets: &[nuvo_contracts::catalog::SetSummary]| sets.iter().map(|s| (s.id.clone(), s.release_type)).collect::<Vec<_>>();
    assert_eq!(ids(&page.albums), [("sc_playlist_1".to_string(), None), ("sc_playlist_4".to_string(), None)]);
    assert_eq!(ids(&page.singles), [("sc_playlist_2".to_string(), Some("ep")), ("sc_playlist_3".to_string(), Some("single"))]);
}

#[tokio::test]
async fn failed_listings_leave_their_part_empty() {
    let (fx, sc) = setup().await;
    fx.on(&api("users/9"), Reply::json(user(9, "nightowl")));
    fx.on(&api("users/9/toptracks"), Reply::status(500));
    fx.on(&api("users/9/albums"), Reply::status(500));
    fx.on(&api("users/9/tracks"), Reply::json(listing(vec![track(22, "c", 1)])));
    let page = sc.artist("sc_user_9").await.unwrap();
    assert_eq!(ids_of(&page.tracks), ["sc:22"]);
    assert!(page.albums.is_empty() && page.singles.is_empty());
    fx.on(&api("users/8"), Reply::status(500));
    assert_eq!(sc.artist("sc_user_8").await.unwrap_err(), ScError::Status(500));
    fx.on(&api("users/7"), Reply::json(json!({"id": 7, "kind": "user"})));
    assert_eq!(sc.artist("sc_user_7").await.unwrap_err(), ScError::NotFound);
}

#[tokio::test]
async fn foreign_ids_are_invalid_without_a_request() {
    let (fx, sc) = setup().await;
    assert_eq!(sc.artist("UC123").await.unwrap_err(), ScError::Invalid("UC123".into()));
    assert!(matches!(sc.track("sc_user_1").await, Err(ScError::Invalid(_))));
    assert!(matches!(sc.album("sc:1").await, Err(ScError::Invalid(_))));
    assert_eq!(fx.total(), 0);
}

#[tokio::test]
async fn placeholders_are_filled_in_set_order() {
    let (fx, sc) = setup().await;
    fx.on(&api("playlists/3"), Reply::json(json!({"id": 3, "title": "Mix", "user": user(9, "dj"), "tracks": [track(31, "A", 1000), {"id": 32, "kind": "track"}]})));
    fx.on(&api("tracks"), Reply::json(json!([track(32, "B", 2000)])));
    let playlist = sc.playlist("sc_playlist_3").await.unwrap();
    assert_eq!(ids_of(&playlist.tracks), ["sc:31", "sc:32"]);
    assert_eq!(playlist.duration_ms, 3000);
    let batches = fx.hits(&api("tracks"));
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].query["ids"], "32");
    assert_eq!(fx.hits(&api("playlists/3"))[0].query["representation"], "full");
}

#[tokio::test]
async fn placeholders_load_in_sequential_batches_of_50_and_a_failed_batch_is_skipped() {
    let (fx, sc) = setup().await;
    let mut tracks = vec![track(1, "Has title", 1000)];
    tracks.extend((100..220).map(|id| json!({"id": id})));
    fx.on(&api("playlists/4"), Reply::json(json!({"id": 4, "title": "Long", "user": user(9, "dj"), "tracks": tracks})));
    fx.on_fn(&api("tracks"), |hit| {
        let ids: Vec<u64> = hit.query["ids"].split(',').map(|s| s.parse().unwrap()).collect();
        if ids.contains(&150) {
            return Reply::status(500);
        }
        Reply::json(Value::Array(ids.iter().map(|id| track(*id, "Filled", 1000)).collect()))
    });
    let album = sc.album("sc_playlist_4").await.unwrap();
    let sizes: Vec<usize> = fx.hits(&api("tracks")).iter().map(|h| h.query["ids"].split(',').count()).collect();
    assert_eq!(sizes, [50, 50, 20]);
    assert_eq!(album.tracks.len(), 1 + 70, "the failed batch (ids 150..199) is dropped");
    assert_eq!(album.tracks[0].id, "sc:1");
    assert_eq!(album.tracks[1].id, "sc:100");
    assert_eq!(album.track_count, 71);
}

#[tokio::test]
async fn related_tracks_are_cut_to_the_limit_and_failures_are_empty() {
    let (fx, sc) = setup().await;
    fx.on(&api("tracks/1/related"), Reply::json(listing(vec![track(41, "a", 1), track(42, "b", 1), track(43, "c", 1)])));
    assert_eq!(ids_of(&sc.related("sc:1", 2).await.unwrap()), ["sc:41", "sc:42"]);
    fx.on(&api("tracks/2/related"), Reply::status(500));
    assert!(sc.related("sc:2", 25).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_track_read_twice_costs_one_request() {
    let (fx, sc) = setup().await;
    fx.on(&api("tracks/5"), Reply::json(track(5, "Song", 1000)));
    sc.track("sc:5").await.unwrap();
    sc.track("soundcloud:tracks:5").await.unwrap();
    sc.track_record(5).await.unwrap();
    assert_eq!(fx.count(&api("tracks/5")), 1);
    fx.on(&api("tracks/6"), Reply::json(json!({"id": 6, "title": " "})));
    assert_eq!(sc.track("sc:6").await.unwrap_err(), ScError::NotFound);
}

#[tokio::test]
async fn lookup_resolves_the_canonical_link() {
    let (fx, sc) = setup().await;
    fx.on(&api("resolve"), Reply::json(set(5, "")));
    sc.lookup("https://m.soundcloud.com/someone/sets/mix?si=abc", TypeFilter::All).await;
    assert_eq!(fx.hits(&api("resolve"))[0].query["url"], "https://soundcloud.com/someone/sets/mix");
}

#[tokio::test]
async fn short_links_are_followed_and_lose_their_query() {
    let (fx, sc) = setup().await;
    fx.on("https://on.soundcloud.com/AbC", Reply::redirect("https://soundcloud.com/someone/track-a?utm=x"));
    fx.on("https://soundcloud.com/someone/track-a", Reply::text("<html></html>"));
    fx.on(&api("resolve"), Reply::json(track(7, "A", 1)));
    let found = sc.lookup("on.soundcloud.com/AbC", TypeFilter::Track).await;
    assert_eq!(fx.hits(&api("resolve"))[0].query["url"], "https://soundcloud.com/someone/track-a");
    assert!(matches!(&found[..], [SearchResult::Track(t)] if t.id == "sc:7"));
    fx.on("https://on.soundcloud.com/Dead", Reply::redirect("https://evil.example/x"));
    sc.lookup("https://on.soundcloud.com/Dead", TypeFilter::All).await;
    assert_eq!(fx.hits(&api("resolve"))[1].query["url"], "https://on.soundcloud.com/Dead", "a short link that cannot be followed is used as is");
}

#[tokio::test]
async fn lookup_kinds_and_filters() {
    let (fx, sc) = setup().await;
    fx.on(&api("resolve"), Reply::json(set(5, "album")));
    let wire = serde_json::to_value(sc.lookup("soundcloud.com/x/sets/a", TypeFilter::All).await).unwrap();
    assert_eq!(wire[0]["type"], "album");
    assert_eq!(wire[0]["artists"][0]["name"], "nightowl");
    fx.on(&api("resolve"), Reply::json(set(5, "")));
    let wire = serde_json::to_value(sc.lookup("soundcloud.com/x/sets/a", TypeFilter::All).await).unwrap();
    assert_eq!((wire[0]["type"].as_str(), wire[0]["author"].as_str()), (Some("playlist"), Some("nightowl")));
    fx.on(&api("resolve"), Reply::json(track(7, "A", 1)));
    assert!(sc.lookup("soundcloud.com/x/a", TypeFilter::Artist).await.is_empty());
    fx.on(&api("resolve"), Reply::json(json!({"id": 9, "kind": "user", "username": "dj", "avatar_url": "https://i1.sndcdn.com/avatars-9-large.jpg"})));
    let wire = serde_json::to_value(sc.lookup("soundcloud.com/dj", TypeFilter::Artist).await).unwrap();
    assert_eq!((wire[0]["type"].as_str(), wire[0]["cover"]["width"].as_u64()), (Some("artist"), Some(500)));
    fx.on(&api("resolve"), Reply::json(json!({"kind": "system-playlist"})));
    assert!(sc.lookup("soundcloud.com/discover", TypeFilter::All).await.is_empty());
    assert!(sc.lookup("night owl", TypeFilter::All).await.is_empty());
}

#[tokio::test]
async fn likes_pages_accept_both_entry_shapes_and_follow_next() {
    let (fx, sc) = setup().await;
    fx.on(&api("users/9/likes"), Reply::json(json!({"collection": [{"track": track(1, "a", 1)}, track(2, "b", 1), {"playlist": {"id": 3}}], "next_href": api("users/9/likes?cursor=x")})));
    let first = sc.likes_page(9, None).await.unwrap();
    assert_eq!(first.tracks.iter().map(|t| t["id"].as_u64().unwrap()).collect::<Vec<_>>(), [1, 2]);
    assert_eq!(fx.hits(&api("users/9/likes"))[0].query["limit"], "50");
    let second = sc.likes_page(9, first.next.as_deref()).await.unwrap();
    assert_eq!(second.next.as_deref(), Some(api("users/9/likes?cursor=x").as_str()));
    let hit = &fx.hits(&api("users/9/likes"))[1];
    assert_eq!((hit.query["cursor"].as_str(), hit.query["client_id"].as_str()), ("x", ID_A));
}

#[tokio::test]
async fn avatar_is_the_sized_url_or_null() {
    let (fx, sc) = setup().await;
    fx.on(&api("users/9"), Reply::json(user(9, "dj")));
    assert_eq!(sc.avatar("sc_user_9").await.unwrap().as_deref(), Some("https://i1.sndcdn.com/avatars-9-t500x500.jpg"));
    fx.on(&api("users/8"), Reply::json(json!({"id": 8, "username": "x", "avatar_url": null})));
    assert_eq!(sc.avatar("sc_user_8").await.unwrap(), None);
}

#[tokio::test]
async fn likes_page_rejects_forged_next_cursors() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    assert!(matches!(sc.likes_page(9, Some("https://soundcloud.com/users/9/likes?cursor=x")).await, Err(ScError::Invalid(_))));
    assert!(matches!(sc.likes_page(9, Some("https://a-v2.sndcdn.com/users/9/likes?cursor=x")).await, Err(ScError::Invalid(_))));
    let valid = api("users/9/likes?cursor=x");
    fx.on(&valid, Reply::json(json!({"collection": [track(1, "a", 1)], "next_href": null})));
    assert_eq!(sc.likes_page(9, Some(&valid)).await.unwrap().tracks.len(), 1);
}
