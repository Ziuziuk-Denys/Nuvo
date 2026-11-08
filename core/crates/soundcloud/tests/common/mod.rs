#![allow(dead_code)]

use std::time::Duration;

use nuvo_net::fixture::{Fixture, Reply};
use nuvo_soundcloud::{Limits, SoundCloud};
use serde_json::{Value, json};

pub const ID_A: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
pub const ID_B: &str = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2";
pub const HOME: &str = "https://soundcloud.com/";

/// Short timeouts so failure tests stay fast; `max_retry_wait` keeps the real 10 s.
pub const FAST: Limits = Limits {
    api_timeout: Duration::from_millis(500),
    discovery_timeout: Duration::from_secs(2),
    segment_timeout: Duration::from_millis(500),
    max_retry_wait: Duration::from_secs(10),
};

pub fn api(path: &str) -> String {
    format!("https://api-v2.soundcloud.com/{path}")
}

pub fn script_url(name: &str) -> String {
    format!("https://a-v2.sndcdn.com/assets/{name}")
}

/// A homepage that references `scripts` (protocol-relative, like the real page), in order.
pub fn homepage(fx: &Fixture, scripts: &[&str]) {
    let tags: String = scripts.iter().map(|s| format!("<script crossorigin src=\"//a-v2.sndcdn.com/assets/{s}\"></script>\n")).collect();
    fx.on(HOME, Reply::bytes("text/html", format!("<html><body>{tags}</body></html>")));
}

pub fn script(fx: &Fixture, name: &str, client_id: Option<&str>) {
    let body = match client_id {
        Some(id) => format!("var a=1;({{client_id: \"{id}\",env:\"production\"}})"),
        None => "var nothing = 'here';".to_string(),
    };
    fx.on(&script_url(name), Reply::bytes("application/javascript", body));
}

/// A fixture whose homepage exposes `ID_A` and a client using it.
pub async fn setup() -> (Fixture, SoundCloud) {
    let fx = Fixture::start().await;
    homepage(&fx, &["0-a.js", "49-b.js"]);
    script(&fx, "0-a.js", None);
    script(&fx, "49-b.js", Some(ID_A));
    let sc = SoundCloud::new(fx.net(), FAST);
    (fx, sc)
}

pub fn user(id: u64, name: &str) -> Value {
    json!({"id": id, "kind": "user", "username": name, "avatar_url": format!("https://i1.sndcdn.com/avatars-{id}-large.jpg")})
}

pub fn track(id: u64, title: &str, duration: i64) -> Value {
    json!({"id": id, "kind": "track", "title": title, "duration": duration, "user": user(9, "nightowl"), "artwork_url": null})
}

pub fn listing(items: Vec<Value>) -> Value {
    json!({"collection": items})
}
