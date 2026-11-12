use std::time::{SystemTime, UNIX_EPOCH};

use nuvo_net::Url;
use serde_json::Value;

use crate::client::{SoundCloud, host_allowed};
use crate::hls::AudioSink;
use crate::{Reason, ScError, ids};

const PREVIEW_TOLERANCE_MS: i64 = 5_000;
const UNSIGNED_LIFETIME_MS: i64 = 4 * 60_000;
const DIRECT_REUSE_MARGIN_MS: i64 = 30_000;
const DIRECT_CACHE_LIMIT: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Format {
    pub codec: &'static str,
    pub mime: &'static str,
    pub bitrate: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Transcoding {
    pub url: String,
    pub preset: String,
    pub protocol: String,
    pub mime: String,
    pub snipped: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Playable {
    Direct { url: String, expires_ms: i64, format: Format },
    Assembled { bytes: u64, format: Format },
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn preset_kbps(preset: &str) -> Option<u32> {
    let bytes = preset.as_bytes();
    (1..bytes.len()).find_map(|k| {
        if bytes[k] != b'k' || !bytes[k - 1].is_ascii_digit() {
            return None;
        }
        let start = (0..k).rev().take_while(|&i| bytes[i].is_ascii_digit()).last()?;
        preset[start..k].parse().ok()
    })
}

pub fn format_of(preset: &str, mime: &str) -> Format {
    let (preset_lc, mime) = (preset.to_ascii_lowercase(), mime.to_ascii_lowercase());
    let (codec, mime_type, default) = if mime.contains("opus") || preset_lc.contains("opus") {
        ("opus", "audio/ogg; codecs=\"opus\"", 64)
    } else if mime.contains("mp4") || mime.contains("aac") || preset_lc.starts_with("aac") {
        ("aac", "audio/mp4", 128)
    } else {
        ("mp3", "audio/mpeg", 128)
    };
    Format { codec, mime: mime_type, bitrate: preset_kbps(&preset_lc).unwrap_or(default) * 1000 }
}

pub fn transcodings(record: &Value) -> Vec<Transcoding> {
    let list = record.pointer("/media/transcodings").and_then(Value::as_array).cloned().unwrap_or_default();
    list.iter()
        .filter_map(|t| {
            Some(Transcoding {
                url: t.get("url")?.as_str()?.to_string(),
                preset: t.get("preset").and_then(Value::as_str).unwrap_or_default().to_string(),
                protocol: t.pointer("/format/protocol")?.as_str()?.to_string(),
                mime: t.pointer("/format/mime_type").and_then(Value::as_str).unwrap_or_default().to_ascii_lowercase(),
                snipped: t.get("snipped") == Some(&Value::Bool(true)),
            })
        })
        .collect()
}

pub fn availability(record: &Value) -> Result<(), Reason> {
    let policy = record.get("policy").and_then(Value::as_str).unwrap_or("ALLOW").to_ascii_uppercase();
    if policy == "BLOCK" {
        return Err(Reason::RegionBlocked);
    }
    let all = transcodings(record);
    let duration = record.get("duration").and_then(Value::as_i64).filter(|d| *d > 0);
    let full = record.get("full_duration").and_then(Value::as_i64).filter(|d| *d > 0);
    let cut_short = matches!((duration, full), (Some(d), Some(f)) if f - d > PREVIEW_TOLERANCE_MS);
    if policy == "SNIP" || (!all.is_empty() && all.iter().all(|t| t.snipped)) || cut_short {
        return Err(Reason::Preview);
    }
    if record.get("streamable") == Some(&Value::Bool(false)) {
        return Err(Reason::StreamDisabled);
    }
    Ok(())
}

pub fn candidates(record: &Value) -> Vec<Transcoding> {
    let mut usable: Vec<Transcoding> = transcodings(record)
        .into_iter()
        .filter(|t| !t.snipped && (t.protocol == "progressive" || (t.protocol == "hls" && !t.mime.contains("mpegurl"))))
        .collect();
    usable.sort_by_key(|t| {
        let codec = format_of(&t.preset, &t.mime).codec;
        match (t.protocol.as_str(), codec) {
            ("progressive", "mp3") => 0,
            ("progressive", _) => 1,
            (_, "mp3") => 2,
            (_, "aac") => 3,
            _ => 4,
        }
    });
    usable
}

fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for c in text.bytes().filter(|c| *c != b'=') {
        acc = (acc << 6) | u32::from(value(c)?);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

pub fn expiry_ms(url: &str, now: i64) -> i64 {
    let fallback = now + UNSIGNED_LIFETIME_MS;
    let Ok(url) = Url::parse(url) else { return fallback };
    let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    let find = |key: &str| pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
    let from_expires = find("Expires").or_else(|| find("expires")).and_then(|v| v.parse::<i64>().ok()).filter(|s| *s > 0);
    let seconds = from_expires.or_else(|| {
        let policy = find("Policy")?.replace('-', "+").replace('_', "=").replace('~', "/");
        let json: Value = serde_json::from_slice(&base64_decode(&policy)?).ok()?;
        json.pointer("/Statement/0/Condition/DateLessThan/AWS:EpochTime")?.as_i64()
    });
    match seconds.map(|s| s * 1000) {
        Some(ms) if ms > now => ms,
        _ => fallback,
    }
}

pub fn external_record(info: &Value) -> Value {
    let formats = info.get("formats").and_then(Value::as_array).cloned().unwrap_or_default();
    let transcodings: Vec<Value> = formats
        .iter()
        .filter_map(|f| {
            let id = f.get("format_id")?.as_str()?;
            let url = f.get("url")?.as_str()?;
            let protocol = match f.get("protocol")?.as_str()? {
                "http" | "https" => "progressive",
                "m3u8" | "m3u8_native" => "hls",
                _ => return None,
            };
            let mime = match f.get("ext").and_then(Value::as_str)? {
                "mp3" => "audio/mpeg",
                "m4a" | "aac" | "mp4" => "audio/mp4",
                "opus" | "ogg" => "audio/ogg; codecs=\"opus\"",
                _ => return None,
            };
            let snipped = id.contains("preview") || id.starts_with("hls-aes") || url.contains("/encrypted-hls");
            let preset = id.split_once('_').map_or(id, |(_, rest)| rest);
            Some(serde_json::json!({"url": url, "preset": preset, "snipped": snipped, "format": {"protocol": protocol, "mime_type": mime}}))
        })
        .collect();
    serde_json::json!({"media": {"transcodings": transcodings}})
}

impl SoundCloud {
    async fn media_url(&self, transcoding: &Transcoding, authorization: Option<&str>) -> Result<String, ScError> {
        let params: Vec<(&str, String)> = authorization.map(|a| ("track_authorization", a.to_string())).into_iter().collect();
        let answer = self.api(&transcoding.url, &params).await?;
        answer.get("url").and_then(Value::as_str).filter(|u| !u.is_empty()).map(str::to_string).ok_or_else(|| ScError::Upstream("SoundCloud gave no media URL".into()))
    }

    pub async fn resolve(&self, id: &str, sink: &mut impl AudioSink) -> Result<Playable, ScError> {
        let num = ids::track_num(id).ok_or(ScError::Unplayable(Reason::Gone))?;
        if let Some(cached) = self.cached_direct(num) {
            return Ok(cached);
        }
        let record = match self.track_record(num).await {
            Ok(record) => record,
            Err(ScError::NotFound) | Err(ScError::Status(404 | 410)) => return Err(ScError::Unplayable(Reason::Gone)),
            Err(ScError::Status(403)) => return Err(ScError::Unplayable(Reason::RegionBlocked)),
            Err(err) => return Err(err),
        };
        if record.get("id").and_then(Value::as_u64).is_none() {
            return Err(ScError::Unplayable(Reason::Gone));
        }
        availability(&record).map_err(ScError::Unplayable)?;
        let authorization = record.get("track_authorization").and_then(Value::as_str);
        let mut last = ScError::Unplayable(Reason::NoFormat);
        for transcoding in candidates(&record) {
            let attempt = async {
                let media = self.media_url(&transcoding, authorization).await?;
                self.play_media(&media, &transcoding, sink).await
            };
            match attempt.await {
                Ok(playable) => {
                    self.remember_direct(num, &playable);
                    return Ok(playable);
                }
                Err(err) => {
                    tracing::debug!(preset = %transcoding.preset, %err, "SoundCloud transcoding failed");
                    sink.discard().await;
                    last = err;
                }
            }
        }
        Err(last)
    }

    pub async fn resolve_external(&self, id: &str, info: &Value, sink: &mut impl AudioSink) -> Result<Playable, ScError> {
        let num = ids::track_num(id).ok_or(ScError::Unplayable(Reason::Gone))?;
        let mut last = ScError::Unplayable(Reason::NoFormat);
        for transcoding in candidates(&external_record(info)) {
            match self.play_media(&transcoding.url, &transcoding, sink).await {
                Ok(playable) => {
                    self.remember_direct(num, &playable);
                    return Ok(playable);
                }
                Err(err) => {
                    sink.discard().await;
                    last = err;
                }
            }
        }
        Err(last)
    }

    async fn play_media(&self, media: &str, transcoding: &Transcoding, sink: &mut impl AudioSink) -> Result<Playable, ScError> {
        let format = format_of(&transcoding.preset, &transcoding.mime);
        let url = Url::parse(media).map_err(|e| ScError::Upstream(e.to_string()))?;
        if transcoding.protocol == "progressive" {
            if url.scheme() != "https" || !url.host_str().is_some_and(host_allowed) {
                return Err(ScError::Upstream("progressive URL is not https or not from an allowed host".into()));
            }
            return Ok(Playable::Direct { expires_ms: expiry_ms(media, now_ms()), url: media.to_string(), format });
        }
        Ok(Playable::Assembled { bytes: self.assemble(&url, sink).await?, format })
    }

    fn cached_direct(&self, num: u64) -> Option<Playable> {
        let cache = self.inner.direct.lock().unwrap();
        let playable = cache.get(&num)?;
        match playable {
            Playable::Direct { expires_ms, .. } if *expires_ms - DIRECT_REUSE_MARGIN_MS > now_ms() => Some(playable.clone()),
            _ => None,
        }
    }

    fn remember_direct(&self, num: u64, playable: &Playable) {
        if matches!(playable, Playable::Direct { .. }) {
            let mut cache = self.inner.direct.lock().unwrap();
            cache.retain(|_, p| matches!(p, Playable::Direct { expires_ms, .. } if *expires_ms > now_ms()));
            if cache.len() >= DIRECT_CACHE_LIMIT {
                cache.clear();
            }
            cache.insert(num, playable.clone());
        }
    }
}
