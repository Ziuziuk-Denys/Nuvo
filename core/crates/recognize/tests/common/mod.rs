#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::{Json, OriginalUri, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use nuvo_recognize::Pace;
use serde_json::{Value, json};

pub const FAST: Pace = Pace { spacing: Duration::ZERO, backoff: [Duration::from_millis(5); 3] };

pub struct Recorded {
    pub uri: String,
    pub headers: HeaderMap,
    pub body: Value,
}

#[derive(Clone)]
struct Mock {
    replies: Arc<Mutex<VecDeque<(u16, Value)>>>,
    seen: Arc<Mutex<Vec<Recorded>>>,
}

pub struct MockShazam {
    pub url: String,
    pub seen: Arc<Mutex<Vec<Recorded>>>,
}

impl MockShazam {
    pub fn count(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
}

pub async fn mock_shazam(replies: Vec<(u16, Value)>) -> MockShazam {
    let mock = Mock { replies: Arc::new(Mutex::new(replies.into())), seen: Arc::default() };
    let seen = mock.seen.clone();
    let app = Router::new().route("/discovery/v5/{*rest}", post(answer)).with_state(mock);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    MockShazam { url: format!("http://{addr}"), seen }
}

async fn answer(State(mock): State<Mock>, OriginalUri(uri): OriginalUri, headers: HeaderMap, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    mock.seen.lock().unwrap().push(Recorded { uri: uri.to_string(), headers, body });
    let (status, reply) = mock.replies.lock().unwrap().pop_front().unwrap_or((200, no_match()));
    (StatusCode::from_u16(status).unwrap(), Json(reply))
}

pub fn no_match() -> Value {
    json!({"matches": [], "timestamp": 1, "timezone": "Europe/Moscow", "tagid": "x"})
}

/// Trimmed from a real reply (ShazamIO cassette, "I Will Survive").
pub fn found() -> Value {
    json!({
        "matches": [{"id": "211404070", "offset": 92.90471875, "timeskew": 4.684925e-05, "frequencyskew": -0.00016111135}],
        "timestamp": 428211189,
        "timezone": "Europe/Paris",
        "tagid": "x",
        "track": {
            "key": "53982678",
            "title": "I Will Survive",
            "subtitle": "Gloria Gaynor",
            "isrc": "USUR10200634",
            "genres": {"primary": "Pop"},
            "images": {
                "coverart": "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/0c/72/a1/19UMGIM66006.rgb.jpg/400x400cc.jpg",
                "coverarthq": "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/0c/72/a1/19UMGIM66006.rgb.jpg/400x400cc.jpg"
            },
            "sections": [
                {"type": "SONG", "metadata": [
                    {"title": "Album", "text": "Love Tracks"},
                    {"title": "Label", "text": "Polydor"},
                    {"title": "Released", "text": "1978"}
                ]},
                {"type": "RELATED"}
            ],
            "hub": {
                "type": "APPLEMUSIC",
                "actions": [
                    {"name": "apple", "type": "applemusicplay", "id": "1475006475"},
                    {"name": "apple", "type": "uri", "uri": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_1.plus.aac.ep.m4a"}
                ],
                "options": [{"caption": "OPEN IN", "actions": [
                    {"name": "hub:applemusic:deeplink", "type": "applemusicopen",
                     "uri": "https://music.apple.com/gb/album/i-will-survive/1475006468?i=1475006475&mttnagencyid=s2n&itscg=30201"}
                ]}]
            }
        }
    })
}

pub fn pulsed_tone(hz: f32, samples: usize) -> Vec<i16> {
    (0..samples)
        .map(|n| {
            let t = n as f32 / 16_000.0;
            let envelope = if (n / 4000) % 2 == 0 { 1.0 } else { 0.1 };
            (envelope * 8000.0 * (2.0 * std::f32::consts::PI * hz * t).sin()) as i16
        })
        .collect()
}
