use nuvo_contracts::catalog::ArtistRef;
use nuvo_net::Url;
use serde_json::{Value, json};

use crate::client::SoundCloud;
use crate::link::{self, Link};
use crate::{ScError, ids, map};

#[derive(Debug, Clone, PartialEq)]
pub struct ImportListing {
    pub label: String,
    pub likes_of: Option<String>,
    pub rows: Vec<Value>,
    pub partial: bool,
}

/// Pages of 50 likes: enough for the daemon's 20,000-row import cap.
const LIKES_PAGES: usize = 400;

fn text(record: &Value, pointer: &str) -> Option<String> {
    record.pointer(pointer)?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn strip_artist(title: &str, artist: &str) -> String {
    for separator in [" - ", " – ", " — "] {
        if let Some((head, rest)) = title.split_once(separator)
            && !rest.trim().is_empty()
            && head.trim().to_lowercase() == artist.trim().to_lowercase()
        {
            return rest.trim().to_string();
        }
    }
    title.trim().to_string()
}

pub fn import_row(record: &Value, set_artwork: Option<&str>) -> Option<Value> {
    let mut track = map::track(record)?;
    let artist = text(record, "/publisher_metadata/artist").or_else(|| text(record, "/user/username"));
    if let Some(artist) = &artist {
        track.title = strip_artist(&track.title, artist);
        track.artists = vec![ArtistRef { id: track.artists.first().map(|a| a.id.clone()).unwrap_or_default(), name: artist.clone() }];
    }
    let artwork = text(record, "/artwork_url");
    let avatar = text(record, "/user/avatar_url");
    track.cover = map::cover(artwork.as_deref().or(set_artwork).or(avatar.as_deref()));
    let album = text(record, "/publisher_metadata/release_title");
    let mut row = json!({ "title": track.title, "artists": artist.into_iter().collect::<Vec<_>>() });
    if let Some(album) = album {
        row["album"] = json!(album);
    }
    if track.duration_ms > 0 {
        row["durationMs"] = json!(track.duration_ms);
    }
    row["track"] = serde_json::to_value(&track).ok()?;
    Some(row)
}

impl SoundCloud {
    // Short links are followed and must land on SoundCloud again
    async fn canonical_link(&self, input: &str) -> Result<String, ScError> {
        let invalid = || ScError::Invalid(input.trim().to_string());
        match link::parse(input).ok_or_else(invalid)? {
            Link::Canonical(url) => Ok(url),
            Link::Short(short) => match self.follow_short(&short).await.and_then(|url| link::parse(&url)) {
                Some(Link::Canonical(url)) => Ok(url),
                _ => Err(invalid()),
            },
        }
    }

    pub async fn import_listing(&self, input: &str) -> Result<ImportListing, ScError> {
        let canonical = self.canonical_link(input).await?;
        let url = Url::parse(&canonical).map_err(|_| ScError::Invalid(canonical.clone()))?;
        let parts: Vec<&str> = url.path_segments().map(|s| s.filter(|p| !p.is_empty()).collect()).unwrap_or_default();
        if let [user, "likes"] = parts[..] {
            return self.likes_listing(user).await;
        }
        let entity = self.api("resolve", &[("url", canonical.clone())]).await?;
        match entity.get("kind").and_then(Value::as_str) {
            Some("track") => {
                let row = import_row(&entity, None).ok_or(ScError::NotFound)?;
                Ok(ImportListing { label: row["title"].as_str().unwrap_or_default().to_string(), likes_of: None, rows: vec![row], partial: false })
            }
            Some("playlist") => {
                let num = map::num(&entity).ok_or(ScError::NotFound)?;
                let (set, tracks) = self.set_record(&ids::set_id(num)).await?;
                let artwork = text(&set, "/artwork_url");
                Ok(ImportListing {
                    label: text(&set, "/title").unwrap_or_default(),
                    likes_of: None,
                    rows: tracks.iter().filter_map(|t| import_row(t, artwork.as_deref())).collect(),
                    partial: false,
                })
            }
            _ => Err(ScError::Invalid(canonical)),
        }
    }

    async fn likes_listing(&self, user: &str) -> Result<ImportListing, ScError> {
        let profile = self.api("resolve", &[("url", format!("https://soundcloud.com/{user}"))]).await?;
        let num = map::num(&profile).filter(|_| profile.get("kind").and_then(Value::as_str) == Some("user")).ok_or(ScError::NotFound)?;
        let name = text(&profile, "/username").unwrap_or_else(|| user.to_string());
        let mut rows = Vec::new();
        let mut next: Option<String> = None;
        let mut partial = false;
        for _ in 0..LIKES_PAGES {
            let page = match self.likes_page(num, next.as_deref()).await {
                Ok(page) => page,
                Err(_) if !rows.is_empty() => {
                    partial = true;
                    break;
                }
                Err(error) => return Err(error),
            };
            rows.extend(page.tracks.iter().filter_map(|t| import_row(t, None)));
            match page.next {
                Some(more) => next = Some(more),
                None => break,
            }
        }
        Ok(ImportListing { label: name.clone(), likes_of: Some(name), rows, partial })
    }
}
