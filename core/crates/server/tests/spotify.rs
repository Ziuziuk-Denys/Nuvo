mod common;

use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use nuvo_net::Url;
use nuvo_net::fixture::{Fixture, Hit, Reply};
use serde_json::{Value, json};

const PLAYLIST: &str = include_str!("../../import/tests/fixtures/spotify-embed-playlist.html");
const ALBUM: &str = include_str!("../../import/tests/fixtures/spotify-embed-album.html");
const MISSING: &str = include_str!("../../import/tests/fixtures/spotify-embed-missing.html");
const META: &str = include_str!("../../import/tests/fixtures/spotify-playlist-meta.html");
const QUERY_PLAYLIST: &str = include_str!("../../import/tests/fixtures/spotify-query-playlist.json");
const QUERY_ALBUM: &str = include_str!("../../import/tests/fixtures/spotify-query-album.json");
const QUERY_URL: &str = "https://api-partner.spotify.com/pathfinder/v2/query";
const ID: &str = "37i9dQZF1DWXRqgorJj26U";
const ALBUM_ID: &str = "4LH4d3cOWNNsVw41Gqt2kv";

fn embed(kind: &str, id: &str) -> String {
    format!("https://open.spotify.com/embed/{kind}/{id}")
}

fn core(fx: &Fixture) -> common::TestCore {
    common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base)
}

async fn list(core: &common::TestCore, url: &str) -> (StatusCode, Value) {
    let route = Url::parse_with_params("http://core/v1/spotify/import", &[("url", url)]).unwrap();
    common::call(&core.app, "GET", &format!("{}?{}", route.path(), route.query().unwrap()), None).await
}

fn long_embed(page: &str, count: usize) -> String {
    let open = page.find("application/json\">").unwrap() + "application/json\">".len();
    let close = page.rfind("</script>").unwrap();
    let mut data: Value = serde_json::from_str(&page[open..close]).unwrap();
    let tracks = data.pointer_mut("/props/pageProps/state/data/entity/trackList").unwrap();
    *tracks = json!(vec![tracks[0].clone(); count]);
    format!("{}{data}{}", &page[..open], &page[close..])
}

fn long_playlist(count: usize) -> String {
    long_embed(PLAYLIST, count)
}

fn query_page(hit: &Hit, total: usize) -> Reply {
    let asked: Value = serde_json::from_slice(&hit.body).unwrap();
    let offset = asked["variables"]["offset"].as_u64().unwrap() as usize;
    let limit = asked["variables"]["limit"].as_u64().unwrap() as usize;
    let (recorded, list) = match asked["operationName"].as_str() {
        Some("queryAlbumTracks") => (QUERY_ALBUM, "/data/albumUnion/tracksV2"),
        _ => (QUERY_PLAYLIST, "/data/playlistV2/content"),
    };
    let mut data: Value = serde_json::from_str(recorded).unwrap();
    let content = data.pointer_mut(list).unwrap();
    content["items"] = json!(vec![content["items"][0].clone(); total.saturating_sub(offset).min(limit)]);
    content["totalCount"] = json!(total);
    Reply::json(data)
}

fn offsets(fx: &Fixture) -> Vec<u64> {
    fx.hits(QUERY_URL).iter().map(|hit| serde_json::from_slice::<Value>(&hit.body).unwrap()["variables"]["offset"].as_u64().unwrap()).collect()
}

#[tokio::test]
async fn a_playlist_link_lists_its_songs_from_the_embed_page() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", PLAYLIST));
    let core = core(&fx);
    let (status, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}?si=x")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["label"], "Rock Classics");
    assert_eq!(body["rows"][0], json!({"title": "Dreams - 2004 Remaster", "artists": ["Fleetwood Mac"], "durationMs": 257800}));
    assert_eq!(body["rows"][3]["artists"], json!(["Queen", "David Bowie"]));
    assert!(body.get("partial").is_none());
    assert_eq!(fx.log(), [format!("open.spotify.com/embed/playlist/{ID}")]);
}

#[tokio::test]
async fn an_album_link_gives_rows_with_the_album() {
    let fx = Fixture::start().await;
    fx.on(&embed("album", "4LH4d3cOWNNsVw41Gqt2kv"), Reply::bytes("text/html", ALBUM));
    let core = core(&fx);
    let (status, body) = list(&core, "https://open.spotify.com/intl-fr/album/4LH4d3cOWNNsVw41Gqt2kv").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["rows"][0]["album"], "The Dark Side of the Moon");
}

#[tokio::test]
async fn a_full_embed_reads_the_count_and_marks_the_listing_partial() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100)));
    fx.on(&format!("https://open.spotify.com/playlist/{ID}"), Reply::bytes("text/html", META));
    let core = core(&fx);
    let (status, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["rows"].as_array().unwrap().len(), 100);
    assert_eq!((body["partial"].as_bool(), body["total"].as_u64()), (Some(true), Some(200)));
}

#[tokio::test]
async fn exactly_one_hundred_songs_is_complete_and_an_unknown_count_still_warns() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100)));
    fx.on_seq(
        &format!("https://open.spotify.com/playlist/{ID}"),
        vec![Reply::bytes("text/html", "<meta name=\"music:song_count\" content=\"100\"/>"), Reply::status(500)],
    );
    let core = core(&fx);
    let url = format!("https://open.spotify.com/playlist/{ID}");
    let (_, body) = list(&core, &url).await;
    assert!(body.get("partial").is_none());
    let (status, body) = list(&core, &url).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((body["partial"].as_bool(), body.get("total")), (Some(true), None));
}

#[tokio::test]
async fn a_private_or_deleted_playlist_is_not_found() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", MISSING));
    fx.on(&embed("album", "4LH4d3cOWNNsVw41Gqt2kv"), Reply::status(404));
    let core = core(&fx);
    let (status, _) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = list(&core, "https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_changed_page_and_a_failing_service_have_their_own_codes() {
    let fx = Fixture::start().await;
    fx.on_seq(&embed("playlist", ID), vec![Reply::bytes("text/html", "<html>new</html>"), Reply::status(503), Reply::status(429)]);
    let core = core(&fx);
    let url = format!("https://open.spotify.com/playlist/{ID}");
    let (status, body) = list(&core, &url).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_GATEWAY, Some("SOURCE_CHANGED")));
    let (status, body) = list(&core, &url).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_GATEWAY, Some("UPSTREAM")));
    let (status, _) = list(&core, &url).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn short_links_are_followed_only_while_they_stay_on_spotify() {
    let fx = Fixture::start().await;
    fx.on("https://spotify.link/good", Reply::redirect(&format!("https://open.spotify.com/playlist/{ID}?si=1")));
    fx.on(&format!("https://open.spotify.com/playlist/{ID}"), Reply::bytes("text/html", META));
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", PLAYLIST));
    fx.on("https://spotify.link/away", Reply::redirect("https://evil.example/playlist"));
    fx.on("https://spotify.link/home", Reply::redirect("https://open.spotify.com/"));
    fx.on("https://open.spotify.com/", Reply::bytes("text/html", "<html></html>"));
    let core = core(&fx);
    let (status, body) = list(&core, "https://spotify.link/good").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["label"], "Rock Classics");
    let (status, _) = list(&core, "https://spotify.link/away").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!fx.hosts().contains(&"evil.example".to_string()));
    let (status, _) = list(&core, "https://spotify.link/home").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn other_links_are_refused_before_any_request() {
    let fx = Fixture::start().await;
    let core = core(&fx);
    for url in [
        "",
        "https://open.spotify.com/track/3zOYmiNOuyDL0ClxJcEJ0T",
        "https://open.spotify.com/collection/tracks",
        "http://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U",
        "https://127.0.0.1/playlist/37i9dQZF1DWXRqgorJj26U",
        "https://user:pass@spotify.link/x",
        "https://spotify.link:8443/x",
    ] {
        let (status, _) = list(&core, url).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{url}");
    }
    assert_eq!(fx.total(), 0);
}

#[tokio::test]
async fn a_long_playlist_is_read_to_the_end_with_the_embed_token() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100)));
    fx.on_fn(QUERY_URL, |hit| query_page(hit, 250));
    let core = core(&fx);
    let (status, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
    assert_eq!(status, StatusCode::OK);
    let rows = body["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 250);
    assert_eq!(rows[100], json!({"title": "Only You", "artists": ["Yazoo"], "album": "Upstairs at Eric's", "durationMs": rows[100]["durationMs"]}));
    assert!(body.get("partial").is_none());
    assert_eq!(offsets(&fx), [100, 200]);
    let hit = &fx.hits(QUERY_URL)[0];
    let header = |name: &str| hit.headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    assert_eq!(header("authorization"), "Bearer redacted");
    assert!(header("user-agent").starts_with("Mozilla/5.0"));
    assert!(header("cookie").is_empty());
    assert_eq!(fx.count(&format!("https://open.spotify.com/playlist/{ID}")), 0);
    assert!(fx.hits(&embed("playlist", ID))[0].headers["user-agent"].to_str().unwrap().starts_with("Mozilla/5.0"));
}

#[tokio::test]
async fn exactly_one_hundred_songs_takes_one_query_and_no_notice() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100)));
    fx.on_fn(QUERY_URL, |hit| query_page(hit, 100));
    let core = core(&fx);
    let (_, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
    assert_eq!(body["rows"].as_array().unwrap().len(), 100);
    assert!(body.get("partial").is_none());
    assert_eq!(offsets(&fx), [100]);
}

#[tokio::test]
async fn a_long_album_is_read_to_the_end_with_its_title_on_every_row() {
    let fx = Fixture::start().await;
    fx.on(&embed("album", ALBUM_ID), Reply::bytes("text/html", long_embed(ALBUM, 100)));
    fx.on_fn(QUERY_URL, |hit| query_page(hit, 157));
    let core = core(&fx);
    let (status, body) = list(&core, &format!("https://open.spotify.com/album/{ALBUM_ID}")).await;
    assert_eq!(status, StatusCode::OK);
    let rows = body["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 157);
    assert!(rows.iter().all(|row| row["album"] == "The Dark Side of the Moon"));
    assert!(body.get("partial").is_none());
}

#[tokio::test]
async fn a_429_waits_and_tries_again() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100)));
    let calls = std::sync::atomic::AtomicUsize::new(0);
    fx.on_fn(QUERY_URL, move |hit| match calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) {
        0 | 1 => Reply::status(429).header("retry-after", "0"),
        _ => query_page(hit, 150),
    });
    let core = core(&fx);
    let (_, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
    assert_eq!(body["rows"].as_array().unwrap().len(), 150);
    assert!(body.get("partial").is_none());
    assert_eq!(offsets(&fx), [100, 100, 100]);
}

#[tokio::test]
async fn any_failure_past_the_embed_keeps_its_songs_with_the_notice() {
    let refused = Reply::status(401).header("content-type", "application/json").body(r#"{"error":{"status":401}}"#);
    let retired = Reply::status(412).body("Invalid query hash");
    let changed = Reply::json(json!({"data": {"playlistV2": {"__typename": "NotFound"}}}));
    let limited = Reply::status(429).header("retry-after", "0");
    let moved = Reply::redirect("https://api-partner.spotify.com/elsewhere");
    for (case, reply) in [("refused", refused), ("retired", retired), ("changed", changed), ("limited", limited), ("moved", moved)] {
        let fx = Fixture::start().await;
        fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100)));
        fx.on(&format!("https://open.spotify.com/playlist/{ID}"), Reply::bytes("text/html", META));
        fx.on(QUERY_URL, reply);
        let core = core(&fx);
        let (status, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
        assert_eq!(status, StatusCode::OK, "{case}");
        assert_eq!(body["rows"].as_array().unwrap().len(), 100, "{case}");
        assert_eq!((body["partial"].as_bool(), body["total"].as_u64()), (Some(true), Some(200)), "{case}");
        assert_eq!(fx.count(QUERY_URL), if case == "limited" { 4 } else { 1 }, "{case}");
        assert_eq!(fx.count("https://api-partner.spotify.com/elsewhere"), 0, "{case}");
    }
}

#[tokio::test]
async fn a_failure_on_a_later_page_drops_the_pages_read_so_far() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100)));
    fx.on(&format!("https://open.spotify.com/playlist/{ID}"), Reply::bytes("text/html", META));
    let calls = std::sync::atomic::AtomicUsize::new(0);
    fx.on_fn(QUERY_URL, move |hit| match calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) {
        0 => query_page(hit, 300),
        _ => Reply::status(500),
    });
    let core = core(&fx);
    let (_, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
    assert_eq!(body["rows"].as_array().unwrap().len(), 100);
    assert_eq!(body["partial"].as_bool(), Some(true));
}

#[tokio::test]
async fn an_embed_without_a_token_or_an_album_that_fails_still_imports() {
    let fx = Fixture::start().await;
    fx.on(&embed("playlist", ID), Reply::bytes("text/html", long_playlist(100).replace("\"accessToken\":\"redacted\",", "")));
    fx.on(&format!("https://open.spotify.com/playlist/{ID}"), Reply::bytes("text/html", META));
    fx.on(&embed("album", ALBUM_ID), Reply::bytes("text/html", long_embed(ALBUM, 100)));
    fx.on(QUERY_URL, Reply::status(503));
    let core = core(&fx);
    let (_, body) = list(&core, &format!("https://open.spotify.com/playlist/{ID}")).await;
    assert_eq!((body["rows"].as_array().unwrap().len(), body["partial"].as_bool()), (100, Some(true)));
    assert_eq!(fx.count(QUERY_URL), 0);
    let (status, body) = list(&core, &format!("https://open.spotify.com/album/{ALBUM_ID}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((body["rows"].as_array().unwrap().len(), body["partial"].as_bool(), body.get("total")), (100, Some(true), None));
}

/// Reaches the real Spotify, so it runs only by hand: `cargo test -p nuvo-server --test spotify -- --ignored`.
#[tokio::test]
#[ignore]
async fn live_long_public_lists_are_read_in_full() {
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |_| {});
    for url in ["https://open.spotify.com/playlist/3Q1DIJ51dJpUO6RhnIHdVx", "https://open.spotify.com/album/1YYOwsMjqmlG654m8t977S"] {
        let (status, body) = list(&core, url).await;
        let rows = body["rows"].as_array().map_or(0, Vec::len);
        eprintln!("{url}: {status} {rows} rows, partial {:?}", body.get("partial"));
        assert_eq!(status, StatusCode::OK);
        assert!(rows > 100 && body.get("partial").is_none());
    }
}
