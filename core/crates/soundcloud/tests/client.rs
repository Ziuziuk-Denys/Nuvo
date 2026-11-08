mod common;

use std::time::{Duration, Instant};

use common::{HOME, ID_A, ID_B, api, homepage, script, script_url, setup, track};
use nuvo_net::fixture::{Fixture, Reply};
use nuvo_soundcloud::{ScError, SoundCloud, find_client_id, script_urls};

#[test]
fn scripts_and_client_ids_are_found_in_page_text() {
    let html = r#"<script src="https://a-v2.sndcdn.com/assets/1-x.js"></script><script src='//a-v2.sndcdn.com/assets/2-y.js'></script>
        <link href="https://a-v2.sndcdn.com/assets/style.css"><script src="https://a-v2.sndcdn.com/assets/1-x.js"></script>"#;
    assert_eq!(script_urls(html), vec!["https://a-v2.sndcdn.com/assets/1-x.js", "https://a-v2.sndcdn.com/assets/2-y.js"]);
    assert_eq!(find_client_id(&format!("x={{client_id : \"{ID_A}\"}}")).as_deref(), Some(ID_A));
    assert_eq!(find_client_id(&format!("e.client_id=\"{ID_B}\"")).as_deref(), Some(ID_B));
    assert_eq!(find_client_id("client_id:\"short\", client_id:\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\""), None);
}

/// Scripts are read from the last one backwards, and the found id is used.
#[tokio::test]
async fn discovery_reads_scripts_from_last_to_first() {
    let fx = Fixture::start().await;
    homepage(&fx, &["1.js", "2.js", "3.js"]);
    script(&fx, "1.js", Some(ID_A));
    script(&fx, "2.js", None);
    script(&fx, "3.js", None);
    fx.on(&api("tracks/1"), Reply::json(track(1, "Song", 1000)));
    let sc = SoundCloud::new(fx.net(), common::FAST);
    sc.track("sc:1").await.unwrap();
    assert_eq!(
        fx.log(),
        ["soundcloud.com/", "a-v2.sndcdn.com/assets/3.js", "a-v2.sndcdn.com/assets/2.js", "a-v2.sndcdn.com/assets/1.js", "api-v2.soundcloud.com/tracks/1"]
    );
    assert_eq!(fx.hits(&api("tracks/1"))[0].query["client_id"], ID_A);
    assert_eq!(sc.client_id().as_deref(), Some(ID_A));
}

/// Protocol-relative script URLs are fetched over https.
#[tokio::test]
async fn protocol_relative_scripts_are_fetched() {
    let (fx, sc) = setup().await;
    fx.on(&api("tracks/1"), Reply::json(track(1, "Song", 1000)));
    sc.track("1").await.unwrap();
    assert_eq!(fx.count(&script_url("49-b.js")), 1);
}

/// A stored id rejected with 401 is replaced once and the new id is reported.
#[tokio::test]
async fn a_rejected_id_is_rediscovered_and_retried_once() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_B.into()));
    let stored = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let sink = stored.clone();
    sc.on_client_id(move |id| sink.lock().unwrap().push(id.to_string()));
    fx.on_fn(&api("tracks/1"), |hit| if hit.query["client_id"] == ID_A { Reply::json(track(1, "Song", 1000)) } else { Reply::status(401) });
    sc.track("sc:1").await.unwrap();
    let calls = fx.hits(&api("tracks/1"));
    assert_eq!(calls.len(), 2);
    assert_eq!((calls[0].query["client_id"].as_str(), calls[1].query["client_id"].as_str()), (ID_B, ID_A));
    assert_eq!(*stored.lock().unwrap(), vec![ID_A.to_string()]);
}

/// When discovery finds the same id, the caller gets the failure without a second call.
#[tokio::test]
async fn the_same_id_after_rediscovery_is_not_retried() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    fx.on(&api("tracks/1"), Reply::status(403));
    assert_eq!(sc.track("sc:1").await.unwrap_err(), ScError::Status(403));
    assert_eq!(fx.count(&api("tracks/1")), 1);
}

#[tokio::test]
async fn failed_discovery_is_unavailable() {
    let fx = Fixture::start().await;
    fx.on(HOME, Reply::status(500));
    let sc = SoundCloud::new(fx.net(), common::FAST);
    assert_eq!(sc.track("sc:1").await.unwrap_err(), ScError::Unavailable);
    assert_eq!(sc.client_id(), None);
}

/// Ten cold requests share one discovery.
#[tokio::test]
async fn concurrent_cold_requests_discover_once() {
    let (fx, sc) = setup().await;
    fx.on(&api("tracks/1"), Reply::json(track(1, "Song", 1000)));
    let calls = (0..10).map(|_| {
        let sc = sc.clone();
        tokio::spawn(async move { sc.related("sc:1", 5).await })
    });
    for call in calls {
        call.await.unwrap().unwrap();
    }
    assert_eq!(fx.count(HOME), 1);
}

#[tokio::test]
async fn concurrent_cold_requests_with_failed_discovery_perform_one() {
    let fx = Fixture::start().await;
    fx.on(HOME, Reply::status(500));
    let sc = SoundCloud::new(fx.net(), common::FAST);
    let handles: Vec<_> = (0..10).map(|_| {
        let sc = sc.clone();
        tokio::spawn(async move { sc.related("sc:1", 5).await })
    }).collect();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(fx.count(HOME), 1, "discovery should only attempt once");
    for handle in handles {
        assert_eq!(handle.await.unwrap().unwrap(), Vec::new(), "all concurrent calls should return empty list");
    }
}

#[tokio::test]
async fn retry_after_is_honoured_once() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    fx.on_seq(&api("tracks/1"), vec![Reply::status(429).header("retry-after", "1"), Reply::json(track(1, "Song", 1000))]);
    let started = Instant::now();
    sc.track("sc:1").await.unwrap();
    assert!(started.elapsed() >= Duration::from_millis(950), "{:?}", started.elapsed());
    assert_eq!(fx.count(&api("tracks/1")), 2);
    fx.on(&api("tracks/2"), Reply::status(429));
    assert_eq!(sc.track("sc:2").await.unwrap_err(), ScError::RateLimited);
}

#[tokio::test]
async fn parameters_are_set_once_and_client_id_goes_last() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    fx.on(&api("tracks/1/related"), Reply::json(common::listing(vec![])));
    sc.related("sc:1", 3).await.unwrap();
    let hit = &fx.hits(&api("tracks/1/related"))[0];
    assert_eq!((hit.query["limit"].as_str(), hit.query["linked_partitioning"].as_str(), hit.query["client_id"].as_str()), ("3", "1", ID_A));
}

#[tokio::test]
async fn empty_or_scalar_bodies_are_upstream_errors_and_stalls_time_out() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    fx.on(&api("tracks/1"), Reply::json("\"nope\""));
    assert_eq!(sc.track("sc:1").await.unwrap_err(), ScError::Upstream("SoundCloud returned no data".into()));
    fx.on(&api("tracks/2"), Reply::json(track(2, "x", 1)).after(Duration::from_secs(3)));
    assert_eq!(sc.track("sc:2").await.unwrap_err(), ScError::Timeout);
}
