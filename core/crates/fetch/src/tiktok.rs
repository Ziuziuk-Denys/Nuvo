use std::time::Duration;

use nuvo_crypto::{base64_decode, base64_encode};
use reqwest::Url;
use reqwest::header::{ACCEPT_LANGUAGE, COOKIE, SET_COOKIE};
use reqwest::redirect::Policy;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{FetchError, Remote};

pub const TIKTOK_URL: &str = "https://www.tiktok.com";
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const REFERER: &str = "https://www.tiktok.com/";
const DATA_MARK: &str = "id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\"";
const CHALLENGE_LIMIT: u32 = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sound {
    pub remote: Remote,
    pub title: String,
    pub author: String,
    pub duration_ms: u64,
    pub original: bool,
    pub album: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TikTokPost {
    pub id: String,
    pub title: String,
    pub video: Option<Remote>,
    pub duration_ms: u64,
    pub sound: Option<Sound>,
}

/// A post page is a few hundred KB; this only stops a hostile or broken endpoint from filling memory.
const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;

pub struct TikTok {
    client: reqwest::Client,
    base: String,
    base_host: String,
}

impl TikTok {
    // Redirects are followed only to TikTok hosts and the base host
    pub fn new(base: impl Into<String>) -> Self {
        Self::with_proxy(base, None)
    }

    pub fn with_proxy(base: impl Into<String>, proxy: Option<reqwest::Proxy>) -> Self {
        let base = base.into().trim_end_matches('/').to_string();
        let base_host = Url::parse(&base).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
        let base_host_clone = base_host.clone();
        let policy = Policy::custom(move |attempt| {
            let host = attempt.url().host_str().unwrap_or("").to_ascii_lowercase();
            let scheme = attempt.url().scheme();
            let allowed_host = host == "tiktok.com" || host.ends_with(".tiktok.com") || host == base_host_clone;
            let allowed_scheme = scheme == "https" || host == base_host_clone;
            if attempt.previous().len() >= 5 || !allowed_host || !allowed_scheme { attempt.stop() } else { attempt.follow() }
        });
        let mut builder = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(policy)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20));
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Self { client, base, base_host }
    }

    pub async fn post(&self, url: &str) -> Result<TikTokPost, FetchError> {
        self.validate_url(url)?;
        let id = match post_id(url) {
            Some(id) => id,
            None => self.resolve(url).await?,
        };
        let page_url = format!("{}/@i/video/{id}", self.base);
        let (html, mut cookies) = self.page(&page_url, &[]).await?;
        let mut data = rehydration(&html);
        if data.is_none() {
            let solved = tokio::task::spawn_blocking(move || solve_challenge(&html)).await.unwrap_or_default();
            if !solved.is_empty() {
                cookies.extend(solved);
                let (html, more) = self.page(&page_url, &cookies).await?;
                cookies.extend(more);
                data = rehydration(&html);
            }
        }
        parse_post(&data.ok_or(FetchError::Blocked)?, &id, &cookies)
    }

    fn validate_url(&self, url: &str) -> Result<(), FetchError> {
        let parsed = Url::parse(url).map_err(|_| FetchError::Unavailable)?;
        let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
        let scheme = parsed.scheme();
        let tiktok_host = host == "tiktok.com" || host.ends_with(".tiktok.com");
        let allowed_host = tiktok_host || host == self.base_host;
        let allowed_scheme = scheme == "https" || (host == self.base_host && !tiktok_host);
        if allowed_host && allowed_scheme { Ok(()) } else { Err(FetchError::Unavailable) }
    }

    async fn resolve(&self, url: &str) -> Result<String, FetchError> {
        let response = self.client.get(url).send().await.map_err(network)?;
        post_id(response.url().as_str()).ok_or(FetchError::Unavailable)
    }

    async fn page(&self, url: &str, cookies: &[(String, String)]) -> Result<(String, Vec<(String, String)>), FetchError> {
        let mut request = self.client.get(url).header(ACCEPT_LANGUAGE, "en-US,en;q=0.9");
        if !cookies.is_empty() {
            request = request.header(COOKIE, cookie_header(cookies));
        }
        let response = request.send().await.map_err(network)?;
        match response.status().as_u16() {
            200..=299 => {}
            403 | 429 => return Err(FetchError::Blocked),
            404 | 410 => return Err(FetchError::Unavailable),
            status => return Err(FetchError::Network(format!("tiktok answered {status}"))),
        }
        let set: Vec<(String, String)> = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok()?.split(';').next()?.split_once('='))
            .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
            .filter(|(name, _)| !name.is_empty())
            .collect();
        Ok((read_capped(response).await?, set))
    }
}

async fn read_capped(mut response: reqwest::Response) -> Result<String, FetchError> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        if body.len() + chunk.len() > MAX_PAGE_BYTES {
            return Err(FetchError::Network("tiktok page is too large".into()));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn network(err: reqwest::Error) -> FetchError {
    FetchError::Network(err.to_string())
}

fn cookie_header(cookies: &[(String, String)]) -> String {
    cookies.iter().map(|(name, value)| format!("{name}={value}")).collect::<Vec<_>>().join("; ")
}

pub fn post_id(url: &str) -> Option<String> {
    ["/video/", "/photo/", "/v/"].iter().find_map(|mark| {
        let at = url.find(mark)? + mark.len();
        let digits: String = url[at..].chars().take_while(char::is_ascii_digit).collect();
        (15..=21).contains(&digits.len()).then_some(digits)
    })
}

pub fn rehydration(html: &str) -> Option<Value> {
    let tag = html.find(DATA_MARK)?;
    let start = tag + html[tag..].find('>')? + 1;
    let end = start + html[start..].find("</script>")?;
    serde_json::from_str(&html[start..end]).ok()
}

fn attribute<'a>(html: &'a str, id: &str) -> Option<&'a str> {
    let at = html.find(&format!("id=\"{id}\""))?;
    let tag = &html[at..at + html[at..].find('>')?];
    let start = tag.find("class=\"")? + "class=\"".len();
    let end = start + tag[start..].find('"')?;
    Some(&tag[start..end])
}

pub fn solve_challenge(html: &str) -> Vec<(String, String)> {
    solve(html).unwrap_or_default()
}

fn solve(html: &str) -> Option<Vec<(String, String)>> {
    let mut challenge: Value = serde_json::from_slice(&base64_decode(attribute(html, "cs")?)?).ok()?;
    let expected = base64_decode(challenge["v"]["c"].as_str()?)?;
    let prefix = Sha256::new_with_prefix(base64_decode(challenge["v"]["a"].as_str()?)?);
    let answer = (0..CHALLENGE_LIMIT).find(|n| prefix.clone().chain_update(n.to_string()).finalize()[..] == expected[..])?;
    challenge["d"] = Value::String(base64_encode(answer.to_string().as_bytes()));
    let mut cookies = vec![(attribute(html, "wci")?.to_string(), base64_encode(challenge.to_string().as_bytes()))];
    if let (Some(name), Some(value)) = (attribute(html, "rci"), attribute(html, "rs")) {
        cookies.push((name.to_string(), value.to_string()));
    }
    cookies.retain(|(name, _)| !name.is_empty());
    Some(cookies)
}

fn seconds_to_ms(value: &Value) -> u64 {
    let seconds = value.as_f64().or_else(|| value.as_str()?.parse().ok()).unwrap_or(0.0);
    (seconds.max(0.0) * 1000.0).round() as u64
}

/// "original sound" as TikTok writes it in the viewer's language.
const ORIGINAL_SOUND: [&str; 10] = [
    "original sound",
    "оригинальный звук",
    "оригінальний звук",
    "som original",
    "sonido original",
    "son original",
    "suono originale",
    "originalton",
    "oryginalny dźwięk",
    "orijinal ses",
];

fn is_original(music: &Value, title: &str) -> bool {
    let title = title.to_lowercase();
    music["original"].as_bool() == Some(true) || ORIGINAL_SOUND.iter().any(|phrase| title.starts_with(phrase))
}

fn is_tiktok_family(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else { return false };
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    host == "tiktok.com" || host.ends_with(".tiktok.com") ||
    host.ends_with(".tiktokcdn.com") || host.ends_with(".tiktokcdn-us.com") ||
    host.ends_with(".tiktokcdn-eu.com") || host.ends_with(".tiktokv.com")
}

pub fn parse_post(data: &Value, id: &str, cookies: &[(String, String)]) -> Result<TikTokPost, FetchError> {
    let detail = &data["__DEFAULT_SCOPE__"]["webapp.video-detail"];
    let status = detail["statusCode"].as_i64().unwrap_or(0);
    if status != 0 || detail["statusMsg"].as_str().is_some_and(|m| !m.is_empty()) {
        return Err(FetchError::Unavailable);
    }
    let item = &detail["itemInfo"]["itemStruct"];
    if item["isContentClassified"].as_bool() == Some(true) {
        return Err(FetchError::AgeGated);
    }
    if !item["author"].is_object() {
        return Err(FetchError::Unavailable);
    }
    let text = |value: &Value| value.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let referer = ("Referer".to_string(), REFERER.to_string());
    let video = &item["video"];
    let video_url = text(&video["playAddr"]).or_else(|| text(&video["bitrateInfo"][0]["PlayAddr"]["UrlList"][0]));
    let music = &item["music"];
    let sound = text(&music["playUrl"]).map(|url| {
        let title = text(&music["title"]).unwrap_or_else(|| "original sound".to_string());
        let mut sound_headers = vec![referer.clone()];
        if is_tiktok_family(&url) && !cookies.is_empty() {
            sound_headers.push(("Cookie".to_string(), cookie_header(cookies)));
        }
        Sound {
            remote: Remote { url, headers: sound_headers },
            original: is_original(music, &title),
            title,
            author: text(&music["authorName"]).unwrap_or_default(),
            duration_ms: seconds_to_ms(&music["duration"]),
            album: text(&music["album"]),
        }
    });
    if video_url.is_none() && sound.is_none() {
        return Err(FetchError::Unavailable);
    }
    let video_remote = video_url.map(|url| {
        let mut headers = vec![referer.clone()];
        if is_tiktok_family(&url) && !cookies.is_empty() {
            headers.push(("Cookie".to_string(), cookie_header(cookies)));
        }
        Remote { url, headers }
    });
    Ok(TikTokPost {
        id: id.to_string(),
        title: text(&item["desc"]).unwrap_or_else(|| format!("TikTok {id}")),
        video: video_remote,
        duration_ms: seconds_to_ms(&video["duration"]),
        sound,
    })
}
