mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

fn roles() -> Value {
    json!({"field": "#faf6f5", "deep": "#f0e8e6", "raised": "#ffffff", "ink": "#2a1f22",
           "ink2": "rgba(42,31,34,0.7)", "ink3": "rgba(42,31,34,0.62)", "hair": "rgba(42,31,34,0.1)",
           "tint": "rgba(42,31,34,0.05)", "accent": "#c2456b"})
}

fn theme(id: &str) -> Value {
    json!({"format": "nuvo-theme", "version": 1, "id": id, "name": "Dusk Rose", "modes": {"light": roles()}, "defaultMode": "light"})
}

fn font_file(n: u64, bytes: u64) -> Value {
    json!({"id": format!("{n:064x}"), "family": "Inter Display", "format": "woff2", "bytes": bytes, "addedAt": 1})
}

async fn patch(core: &common::TestCore, body: Value) -> (StatusCode, Value) {
    common::call(&core.app, "PATCH", "/v1/appearance", Some(body)).await
}

#[tokio::test]
async fn app_01_defaults_then_round_trip() {
    let core = common::core();
    let (status, fresh) = common::call(&core.app, "GET", "/v1/appearance", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fresh["themes"], json!([]));
    assert_eq!(fresh["active"], json!({"presetId": "nuvo"}));
    assert_eq!(fresh["fonts"], json!({"ui": {"kind": "default"}, "lyrics": {"kind": "default"}, "uiScale": 1.0, "lyricsScale": 1.0}));
    assert_eq!(fresh["customCss"], json!({"enabled": false, "text": ""}));

    let body = json!({
        "themes": [theme("dusk-1")],
        "active": {"presetId": "custom:dusk-1"},
        "fonts": {"ui": {"kind": "system", "family": "Noto Sans"}, "lyrics": {"kind": "file", "id": format!("{:064x}", 1)}, "uiScale": 1.1, "lyricsScale": 1.4},
        "fontFiles": [font_file(1, 1000)],
        "customCss": {"enabled": true, "text": ":root { --n-accent: #c2456b; }"}
    });
    let (status, saved) = patch(&core, body.clone()).await;
    assert_eq!(status, StatusCode::OK);
    let (_, read) = common::call(&core.app, "GET", "/v1/appearance", None).await;
    assert_eq!(read, saved);
    for key in ["themes", "active", "fonts", "fontFiles", "customCss"] {
        assert_eq!(read[key], body[key], "{key}");
    }

    // a patch replaces only the keys it names
    let (_, after) = patch(&core, json!({"customCss": {"enabled": false, "text": ""}})).await;
    assert_eq!(after["themes"], body["themes"]);
}

#[tokio::test]
async fn app_02_unknown_keys_and_shapes_are_refused() {
    let core = common::core();
    for bad in [
        json!({"wallpaper": "x"}),
        json!({"themes": [{"format": "nuvo-theme", "version": 1, "id": "a", "name": "A", "modes": {"light": roles()}, "defaultMode": "light", "script": "x"}]}),
        json!({"fonts": {"ui": {"kind": "url", "href": "https://example.org/f.woff2"}, "lyrics": {"kind": "default"}, "uiScale": 1.0, "lyricsScale": 1.0}}),
        json!({"fonts": {"ui": {"kind": "default", "extra": 1}, "lyrics": {"kind": "default"}, "uiScale": 1.0, "lyricsScale": 1.0}}),
        json!({"fonts": {"ui": {"kind": "system", "family": "Noto Sans", "file": "/usr/share/fonts/x.ttf"}, "lyrics": {"kind": "default"}, "uiScale": 1.0, "lyricsScale": 1.0}}),
    ] {
        let (status, error) = patch(&core, bad.clone()).await;
        assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{bad}");
    }
}

#[tokio::test]
async fn app_03_caps_and_values() {
    let core = common::core();
    let many: Vec<Value> = (0..51).map(|i| theme(&format!("t{i}"))).collect();
    let mut long_name = theme("n");
    long_name["name"] = json!("x".repeat(41));
    let mut colour_word = theme("c");
    colour_word["modes"]["light"]["accent"] = json!("url(https://example.org)");
    let mut no_modes = theme("m");
    no_modes["modes"] = json!({});
    let mut big_css = theme("b");
    big_css["css"] = json!("a".repeat(32 * 1024 + 1));
    let fonts = |family: &str, scale: f64| json!({"ui": {"kind": "system", "family": family}, "lyrics": {"kind": "default"}, "uiScale": scale, "lyricsScale": 1.0});
    let refused = [
        json!({"themes": many}),
        json!({"themes": [theme("same"), theme("same")]}),
        json!({"themes": [long_name]}),
        json!({"themes": [colour_word]}),
        json!({"themes": [no_modes]}),
        json!({"themes": [big_css]}),
        json!({"active": {"presetId": "custom:../x"}}),
        json!({"fonts": fonts("Evil\"; } body { x", 1.0)}),
        json!({"fonts": fonts("Noto Sans", 1.3)}),
        json!({"fonts": {"ui": {"kind": "file", "id": "../../etc/passwd"}, "lyrics": {"kind": "default"}, "uiScale": 1.0, "lyricsScale": 1.0}}),
        json!({"fontFiles": (0..21).map(|i| font_file(i, 1)).collect::<Vec<_>>()}),
        json!({"fontFiles": [font_file(1, 40 << 20), font_file(2, 25 << 20)]}),
        json!({"customCss": {"enabled": true, "text": "a".repeat(32 * 1024 + 1)}}),
    ];
    for bad in refused {
        let (status, _) = patch(&core, bad.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
    let (_, read) = common::call(&core.app, "GET", "/v1/appearance", None).await;
    assert_eq!(read["themes"], json!([]), "a refused patch stores nothing");

    let (status, _) = patch(&core, json!({"fontFiles": [font_file(1, 40 << 20), font_file(2, 24 << 20)]})).await;
    assert_eq!(status, StatusCode::OK, "exactly 64 MB is allowed");
}
