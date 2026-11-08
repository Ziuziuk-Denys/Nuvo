//! Catalog reads: tracks, related tracks, sets, artist pages, link lookup, and the raw reads imports need.

use std::collections::HashMap;

use nuvo_contracts::catalog::{AlbumDetails, ArtistDetails, Page, PlaylistDetails, SearchResult, SetSummary, Track, TrackDetails};
use nuvo_net::Url;
use serde_json::Value;

use crate::client::{API_URL, SoundCloud};
use crate::link::{self, Link};
use crate::{ScError, ids, map};

const BATCH: usize = 50;
const MAX_BATCH_COUNT: usize = 20;
const TOP_TRACKS: usize = 10;
const UPLOADS: usize = 50;
const RELEASES: usize = 50;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SetView {
    Album,
    Playlist,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TypeFilter {
    All,
    Track,
    Album,
    Playlist,
    Artist,
}

impl TypeFilter {
    pub fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "all" => Self::All,
            "track" => Self::Track,
            "album" => Self::Album,
            "playlist" => Self::Playlist,
            "artist" => Self::Artist,
            _ => return None,
        })
    }

    fn accepts(self, result: &SearchResult) -> bool {
        matches!(
            (self, result),
            (Self::All, _) | (Self::Track, SearchResult::Track(_)) | (Self::Album, SearchResult::Album(_)) | (Self::Playlist, SearchResult::Playlist(_)) | (Self::Artist, SearchResult::Artist(_))
        )
    }
}

#[derive(Debug, PartialEq)]
pub struct LikesPage {
    pub tracks: Vec<Value>,
    pub next: Option<String>,
}

fn collection(listing: &Value) -> (Vec<Value>, Option<String>) {
    let items = listing.get("collection").and_then(Value::as_array).cloned().unwrap_or_default();
    let next = listing.get("next_href").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    (items, next)
}

fn linked(limit: usize) -> [(&'static str, String); 2] {
    [("limit", limit.to_string()), ("linked_partitioning", "1".into())]
}

fn track_num(id: &str) -> Result<u64, ScError> {
    ids::track_num(id).ok_or_else(|| ScError::Invalid(id.trim().to_string()))
}

fn user_num(id: &str) -> Result<u64, ScError> {
    ids::user_num(id).ok_or_else(|| ScError::Invalid(id.trim().to_string()))
}

impl SoundCloud {
    pub async fn track_record(&self, num: u64) -> Result<Value, ScError> {
        self.record(&format!("tracks/{num}"), &[]).await
    }

    pub async fn track(&self, id: &str) -> Result<TrackDetails, ScError> {
        let record = self.track_record(track_num(id)?).await?;
        map::track_details(&record).ok_or(ScError::NotFound)
    }

    /// Track records matching a text query, newest API order; any failure is an error for the caller to count.
    pub async fn search_tracks(&self, query: &str, limit: usize) -> Result<Vec<Value>, ScError> {
        let listing = self.record("search/tracks", &[("q", query.to_string()), ("limit", limit.to_string())]).await?;
        Ok(collection(&listing).0)
    }

    /// Radio seeds. Any failure of the listing is an empty list.
    pub async fn related(&self, id: &str, limit: usize) -> Result<Vec<Track>, ScError> {
        Ok(self.try_related(id, limit).await.unwrap_or_default())
    }

    /// Related tracks where an empty list means SoundCloud has none (also a track it no longer knows)
    /// and any other failure stays an error, so callers can tell a miss from an outage.
    pub async fn try_related(&self, id: &str, limit: usize) -> Result<Vec<Track>, ScError> {
        let num = track_num(id)?;
        let listing = match self.api(&format!("tracks/{num}/related"), &linked(limit)).await {
            Ok(listing) => listing,
            Err(ScError::NotFound) => return Ok(Vec::new()),
            Err(err) => return Err(err),
        };
        Ok(collection(&listing).0.iter().filter_map(map::track).take(limit).collect())
    }

    /// Up to 50 full track records in one call, for imports and placeholder filling.
    pub async fn tracks_by_ids(&self, nums: &[u64]) -> Result<Vec<Value>, ScError> {
        let joined = nums.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
        let answer = self.api("tracks", &[("ids", joined)]).await?;
        Ok(answer.as_array().cloned().unwrap_or_default())
    }

    pub(crate) async fn set_record(&self, id: &str) -> Result<(Value, Vec<Value>), ScError> {
        let num = ids::set_num(id).ok_or_else(|| ScError::Invalid(id.trim().to_string()))?;
        let set = self.record(&format!("playlists/{num}"), &[("representation", "full".into())]).await?;
        let mut tracks = set.get("tracks").and_then(Value::as_array).cloned().unwrap_or_default();
        let placeholders: Vec<u64> = tracks.iter().filter(|t| map::track(t).is_none()).filter_map(map::num).collect();
        let mut filled: HashMap<u64, Value> = HashMap::new();
        for batch in placeholders.chunks(BATCH).take(MAX_BATCH_COUNT) {
            if let Ok(records) = self.tracks_by_ids(batch).await {
                filled.extend(records.into_iter().filter_map(|r| map::num(&r).map(|n| (n, r))));
            }
        }
        for track in &mut tracks {
            if let Some(full) = map::num(track).and_then(|n| filled.remove(&n)) {
                *track = full;
            }
        }
        Ok((set, tracks))
    }

    pub async fn album(&self, id: &str) -> Result<AlbumDetails, ScError> {
        let (set, tracks) = self.set_record(id).await?;
        map::album(&set, &tracks).ok_or(ScError::NotFound)
    }

    pub async fn playlist(&self, id: &str) -> Result<PlaylistDetails, ScError> {
        let (set, tracks) = self.set_record(id).await?;
        map::playlist(&set, &tracks).ok_or(ScError::NotFound)
    }

    async fn listing(&self, path: &str, limit: usize) -> Option<(Vec<Value>, Option<String>)> {
        self.api(path, &linked(limit)).await.ok().map(|l| collection(&l))
    }

    pub async fn artist(&self, id: &str) -> Result<ArtistDetails, ScError> {
        let num = user_num(id)?;
        let paths = [format!("users/{num}"), format!("users/{num}/toptracks"), format!("users/{num}/tracks"), format!("users/{num}/albums")];
        let (user, top, uploads, releases) = tokio::join!(
            self.record(&paths[0], &[]),
            self.listing(&paths[1], TOP_TRACKS),
            self.listing(&paths[2], UPLOADS),
            self.listing(&paths[3], RELEASES),
        );
        let user = user?;
        let artist = map::user_ref(&user).ok_or(ScError::NotFound)?;
        let (top, _) = top.unwrap_or_default();
        let (uploads, tracks_next) = uploads.unwrap_or_default();
        let (releases, releases_next) = releases.unwrap_or_default();
        let mut tracks: Vec<Track> = Vec::new();
        for track in top.iter().chain(&uploads).filter_map(map::track) {
            if !tracks.iter().any(|t| t.id == track.id) {
                tracks.push(track);
            }
        }
        let (singles, albums): (Vec<SetSummary>, Vec<SetSummary>) = releases.iter().filter_map(map::set_summary).partition(|s| s.release_type.is_some());
        Ok(ArtistDetails {
            id: artist.id,
            name: map::artist_summary(&user).map_or(artist.name, |a| a.name),
            bio: user.get("description").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string),
            cover: map::cover(user.get("avatar_url").and_then(Value::as_str)),
            verified: user.get("verified") == Some(&Value::Bool(true)),
            tracks,
            albums,
            singles,
            tracks_next,
            releases_next,
        })
    }

    /// The next page of an artist listing. `cursor` must be a `next` value this module produced.
    async fn page(&self, id: &str, listing: &str, cursor: &str) -> Result<(Vec<Value>, Option<String>), ScError> {
        let num = user_num(id)?;
        let url = Url::parse(cursor).map_err(|_| ScError::Invalid(cursor.to_string()))?;
        let api = Url::parse(API_URL).unwrap();
        if url.host_str() != api.host_str() || url.scheme() != "https" || url.path() != format!("/users/{num}/{listing}") {
            return Err(ScError::Invalid(cursor.to_string()));
        }
        Ok(collection(&self.api(cursor, &[]).await?))
    }

    pub async fn artist_tracks(&self, id: &str, cursor: &str) -> Result<Page<Track>, ScError> {
        let (items, next) = self.page(id, "tracks", cursor).await?;
        Ok(Page { items: items.iter().filter_map(map::track).collect(), next })
    }

    pub async fn artist_releases(&self, id: &str, cursor: &str) -> Result<Page<SetSummary>, ScError> {
        let (items, next) = self.page(id, "albums", cursor).await?;
        Ok(Page { items: items.iter().filter_map(map::set_summary).collect(), next })
    }

    pub async fn avatar(&self, id: &str) -> Result<Option<String>, ScError> {
        let user = self.record(&format!("users/{}", user_num(id)?), &[]).await?;
        Ok(map::cover(user.get("avatar_url").and_then(Value::as_str)).map(|c| c.url))
    }

    /// The raw entity behind a SoundCloud link (`kind` decides what it is).
    pub async fn resolve_raw(&self, input: &str) -> Result<Value, ScError> {
        let canonical = match link::parse(input).ok_or_else(|| ScError::Invalid(input.trim().to_string()))? {
            Link::Canonical(url) => url,
            Link::Short(short) => self.follow_short(&short).await.unwrap_or(short),
        };
        self.api("resolve", &[("url", canonical)]).await
    }

    pub(crate) async fn follow_short(&self, short: &str) -> Option<String> {
        let response = self.get_url(&Url::parse(short).ok()?, 1024 * 1024, self.inner.limits.api_timeout).await.ok()?;
        let mut url = response.url;
        url.set_query(None);
        Some(url.to_string())
    }

    /// Zero or one result; every failure is "no results".
    pub async fn lookup(&self, input: &str, filter: TypeFilter) -> Vec<SearchResult> {
        let Ok(entity) = self.resolve_raw(input).await else { return Vec::new() };
        let result = match entity.get("kind").and_then(Value::as_str) {
            Some("user") => map::artist_summary(&entity).map(SearchResult::Artist),
            Some("track") => map::track(&entity).map(SearchResult::Track),
            Some("playlist") => map::set_summary(&entity).map(|mut set| {
                set.release_type = None;
                if map::is_album(&entity) {
                    set.artists = Some(map::user_ref(entity.get("user").unwrap_or(&Value::Null)).into_iter().collect());
                    SearchResult::Album(set)
                } else {
                    set.author = Some(entity.pointer("/user/username").and_then(Value::as_str).unwrap_or_default().to_string());
                    SearchResult::Playlist(set)
                }
            }),
            _ => None,
        };
        result.into_iter().filter(|r| filter.accepts(r)).collect()
    }

    /// One page of a user's likes (50 per page); `next` is the previous page's `next`.
    pub async fn likes_page(&self, user: u64, next: Option<&str>) -> Result<LikesPage, ScError> {
        let path = match next {
            Some(next) => {
                let url = Url::parse(next).map_err(|_| ScError::Invalid(next.to_string()))?;
                let api = Url::parse(API_URL).unwrap();
                if url.host_str() != api.host_str() || url.scheme() != "https" || url.path() != format!("/users/{user}/likes") {
                    return Err(ScError::Invalid(next.to_string()));
                }
                next.to_string()
            }
            None => format!("users/{user}/likes"),
        };
        let listing = match next {
            Some(_) => self.api(&path, &[]).await?,
            None => self.api(&path, &[("limit", "50".into())]).await?,
        };
        let (items, next) = collection(&listing);
        let tracks = items
            .into_iter()
            .filter_map(|item| match item.get("track") {
                Some(track) if track.is_object() => Some(track.clone()),
                _ => (item.get("kind").and_then(Value::as_str) == Some("track")).then_some(item),
            })
            .collect();
        Ok(LikesPage { tracks, next })
    }
}
