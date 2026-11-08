//! Lyrics translation through a local model on loopback.
//! Nothing leaves the machine: the target is a stored setting that only the validated settings
//! route can change, the path is fixed, redirects are never followed and the request carries
//! the lyric lines and nothing else.

use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use nuvo_store::settings;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub const MAX_LINES: usize = 400;
pub const MAX_LINE_CHARS: usize = 500;
/// All lines together; a song never comes near it.
pub const MAX_TOTAL_CHARS: usize = 60_000;
const MAX_REPLY_BYTES: usize = 512 * 1024;
const MAX_NAME_CHARS: usize = 200;
const MAX_LANG_CHARS: usize = 40;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const TIMEOUT: Duration = Duration::from_secs(90);
/// The OpenAI-compatible chat route, the only path the daemon ever calls.
const CHAT_PATH: &str = "/v1/chat/completions";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TranslatorBody {
    endpoint: String,
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TranslateBody {
    lang: String,
    lines: Vec<String>,
}

#[derive(Serialize)]
struct Translated {
    lines: Vec<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/lyrics/translator", get(read_translator).put(write_translator)).route("/v1/lyrics/translate", post(translate))
}

/// The one accepted shape is `http://127.0.0.1:P`, `http://localhost:P` or `http://[::1]:P`, with an
/// optional final slash and P an unprivileged port (1024 and up). It is matched as text, not parsed:
/// credentials, other numeric spellings of loopback, DNS names, paths, queries and fragments all
/// fail the comparison. Returns the host and port.
fn loopback_target(endpoint: &str) -> Option<(&str, u16)> {
    let rest = endpoint.strip_prefix("http://")?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let (host, port) = rest.rsplit_once(':')?;
    if !matches!(host, "127.0.0.1" | "localhost" | "[::1]") {
        return None;
    }
    if port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let port: u16 = port.parse().ok()?;
    (port >= 1024).then_some((host, port))
}

fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.chars().count() <= MAX_NAME_CHARS && !model.chars().any(char::is_control)
}

/// The language name goes into the prompt, so it is letters, spaces and hyphens only.
fn valid_lang(lang: &str) -> bool {
    !lang.trim().is_empty() && lang.chars().count() <= MAX_LANG_CHARS && lang.chars().all(|c| c.is_alphabetic() || c == ' ' || c == '-')
}

fn valid_lines(lines: &[String]) -> bool {
    !lines.is_empty()
        && lines.len() <= MAX_LINES
        && lines.iter().all(|line| !line.contains(['\n', '\r']) && line.chars().count() <= MAX_LINE_CHARS)
        && lines.iter().map(|line| line.chars().count()).sum::<usize>() <= MAX_TOTAL_CHARS
}

/// "1. text" or "1) text" lines in order, skipping chatter; None unless exactly `count` arrive in sequence.
fn numbered_lines(reply: &str, count: usize) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for line in reply.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let digits = line.len() - line.trim_start_matches(|c: char| c.is_ascii_digit()).len();
        if digits == 0 {
            continue;
        }
        let number: usize = line[..digits].parse().ok()?;
        if number != out.len() + 1 {
            return None;
        }
        out.push(line[digits..].trim_start_matches(['.', ')', ':']).trim().to_string());
    }
    (out.len() == count).then_some(out)
}

async fn read_translator(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = state.data()?;
    let stored = data.db.call(|c| settings::get(c, settings::LYRICS_TRANSLATOR)).await?;
    Ok(Json(stored.unwrap_or_else(|| json!({"endpoint": null, "model": null}))))
}

async fn write_translator(State(state): State<AppState>, JsonBody(body): JsonBody<TranslatorBody>) -> Result<StatusCode, ApiError> {
    let Some((host, port)) = loopback_target(&body.endpoint) else {
        return Err(ApiError::Invalid("endpoint must be http://127.0.0.1:PORT, http://localhost:PORT or http://[::1]:PORT with PORT from 1024".into()));
    };
    if !valid_model(&body.model) {
        return Err(ApiError::Invalid(format!("model must be 1 to {MAX_NAME_CHARS} characters without control characters")));
    }
    let value = json!({"endpoint": format!("http://{host}:{port}"), "model": body.model});
    let data = state.data()?;
    data.db.call(move |c| settings::set(c, settings::LYRICS_TRANSLATOR, &value)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The reply body, read up to the cap so a runaway model cannot fill memory.
async fn capped_reply(mut response: reqwest::Response) -> Result<Value, ApiError> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ApiError::Upstream("the local model reply broke off".into()))? {
        if body.len() + chunk.len() > MAX_REPLY_BYTES {
            return Err(ApiError::Upstream("the local model reply is too large".into()));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| ApiError::Upstream("the local model reply is not JSON".into()))
}

async fn translate(State(state): State<AppState>, JsonBody(body): JsonBody<TranslateBody>) -> Result<Json<Translated>, ApiError> {
    if !valid_lines(&body.lines) {
        return Err(ApiError::Invalid(format!("1 to {MAX_LINES} single lines of at most {MAX_LINE_CHARS} characters, {MAX_TOTAL_CHARS} in all")));
    }
    if !valid_lang(&body.lang) {
        return Err(ApiError::Invalid(format!("lang is 1 to {MAX_LANG_CHARS} letters")));
    }
    let data = state.data()?;
    let stored = data.db.call(|c| settings::get(c, settings::LYRICS_TRANSLATOR)).await?;
    let stored_text = |key: &str| stored.as_ref().and_then(|v| v.get(key)).and_then(Value::as_str).map(str::to_string);
    let (Some(endpoint), Some(model)) = (stored_text("endpoint"), stored_text("model")) else {
        return Err(ApiError::Conflict("no_translator".into()));
    };
    // checked again on use: a stored value is never trusted blindly
    let Some((host, port)) = loopback_target(&endpoint) else {
        return Err(ApiError::Conflict("no_translator".into()));
    };

    // no proxy and no redirects: the request stays on loopback. "localhost" is pinned to 127.0.0.1,
    // so a changed hosts file cannot point it elsewhere.
    let mut builder = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(CONNECT_TIMEOUT).timeout(TIMEOUT);
    if host == "localhost" {
        builder = builder.resolve("localhost", SocketAddr::from((Ipv4Addr::LOCALHOST, port)));
    }
    let client = builder.build().map_err(|err| ApiError::Internal(err.to_string()))?;
    let url = format!("http://{host}:{port}{CHAT_PATH}");
    let numbered: String = body.lines.iter().enumerate().map(|(index, line)| format!("{}. {line}\n", index + 1)).collect();
    let request = json!({
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": format!("Translate each numbered line into {}. Keep the numbering, one output line per input line, no comments.", body.lang.trim())},
            {"role": "user", "content": numbered},
        ],
    });
    for _ in 0..2 {
        let response = client.post(&url).json(&request).send().await.map_err(|err| {
            if err.is_connect() {
                ApiError::Conflict("no_translator".into())
            } else if err.is_timeout() {
                ApiError::UpstreamTimeout
            } else {
                ApiError::Upstream("the local model could not be reached".into())
            }
        })?;
        if !response.status().is_success() {
            return Err(ApiError::Upstream(format!("the local model answered {}", response.status())));
        }
        let reply = capped_reply(response).await?;
        let text = reply.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default();
        if let Some(lines) = numbered_lines(text, body.lines.len()) {
            return Ok(Json(Translated { lines }));
        }
    }
    Err(ApiError::Upstream("the local model did not keep the line count".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_literal_loopback_targets_pass() {
        assert_eq!(loopback_target("http://127.0.0.1:1234"), Some(("127.0.0.1", 1234)));
        assert_eq!(loopback_target("http://[::1]:1234/"), Some(("[::1]", 1234)));
        assert_eq!(loopback_target("http://localhost:11434"), Some(("localhost", 11434)));
        for bad in ["http://127.0.0.1.example.com:1234", "https://localhost:1234", "http://a:b@localhost:1234", "http://2130706433:1234", "http://localhost:1023"] {
            assert_eq!(loopback_target(bad), None, "{bad}");
        }
    }

    #[test]
    fn numbered_lines_need_the_exact_sequence() {
        assert_eq!(numbered_lines("1. a\n2. b", 2), Some(vec!["a".into(), "b".into()]));
        assert_eq!(numbered_lines("2. b\n1. a", 2), None);
        assert_eq!(numbered_lines("1. a", 2), None);
        assert_eq!(numbered_lines("Sure!\n1: a\n\n2) b", 2), Some(vec!["a".into(), "b".into()]));
    }
}
