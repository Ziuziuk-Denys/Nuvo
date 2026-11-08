//! The Statistics page. One pass over the events in Rust answers everything a period needs, because
//! first plays, streaks and forgotten favourites depend on the whole history anyway. The pass runs over
//! a compact copy (`History`, about 40 bytes per event) that only ever reads the rows it has not seen:
//! decoding 200 000 rows from SQLCipher costs more than the page's whole budget on every range switch.

use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet};

use nuvo_contracts::{
    StatsContextPlays, StatsDay, StatsDetail, StatsMonth, StatsOverview, StatsRange, StatsRow, StatsSessions, StatsShare, StatsStreak, StatsTop, StatsTotals, iso_day,
    iso_from_ms, local_day,
};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::{Value, json};

use crate::{StoreError, settings, tracks};

const COUNTED_MS: i64 = 30_000;
const CALENDAR_DAYS: i64 = 53 * 7;
const TOP_ROWS: usize = 50;
const SIDE_ROWS: usize = 12;
const REPEAT_WINDOW_DAYS: i64 = 14;
const REPEAT_MIN_PLAYS: i64 = 3;
const FORGOTTEN_MIN_PLAYS: i64 = 5;
const FORGOTTEN_SILENT_DAYS: i64 = 60;
const MOST_SKIPPED_MIN: i64 = 2;
const DAY_MS: i64 = 86_400_000;

/// First and last local day (both inside) and today, as day numbers. `None` bounds mean all time.
#[derive(Debug, Clone, Copy)]
pub struct Period {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub today: i64,
}

#[derive(Default, Clone, Copy)]
struct Tally {
    plays: i64,
    ms: i64,
    skips: i64,
    replays: i64,
}

impl Tally {
    fn add(&mut self, other: Tally) {
        self.plays += other.plays;
        self.ms += other.ms;
        self.skips += other.skips;
        self.replays += other.replays;
    }
}

#[derive(Clone)]
struct TrackTally {
    first_ms: i64,
    first_day: i64,
    last_ms: i64,
    all_plays: i64,
    now: Tally,
    before: Tally,
    recent_plays: i64,
    last_session: u32,
}

impl Default for TrackTally {
    fn default() -> Self {
        Self { first_ms: i64::MAX, first_day: i64::MAX, last_ms: i64::MIN, all_plays: 0, now: Tally::default(), before: Tally::default(), recent_plays: 0, last_session: u32::MAX }
    }
}

#[derive(Default)]
struct Rates {
    ms: i64,
    plays: i64,
    /// Plays that had a chance: failed starts and skips before any sound do not.
    heard: i64,
    skipped: i64,
    completed: i64,
}

#[derive(Default)]
struct Session {
    ms: i64,
    started_at: i64,
    counted: i64,
}

/// Text to a small number, so a pass over 200 000 rows stores no strings.
#[derive(Default)]
struct Interner {
    ids: HashMap<String, u32>,
    last: Option<(String, u32)>,
}

impl Interner {
    fn id(&mut self, text: &str) -> u32 {
        if let Some((seen, id)) = &self.last
            && seen == text
        {
            return *id;
        }
        let next = self.ids.len() as u32;
        let id = *self.ids.entry(text.to_string()).or_insert(next);
        match &mut self.last {
            Some((seen, last)) => {
                seen.clear();
                seen.push_str(text);
                *last = id;
            }
            None => self.last = Some((text.to_string(), id)),
        }
        id
    }

    fn in_order(&self) -> Vec<&str> {
        let mut texts = vec![""; self.ids.len()];
        for (text, id) in &self.ids {
            texts[*id as usize] = text;
        }
        texts
    }
}

const REASON_COMPLETE: u8 = 0;
const REASON_SKIP: u8 = 1;
const REASON_ERROR: u8 = 2;
const REASON_OTHER: u8 = 3;
const NO_PLAYLIST: u32 = u32::MAX;

/// One row of `play_events`, as the pass needs it.
#[derive(Clone, Copy)]
struct Event {
    started_at: i64,
    played_ms: i64,
    day: i64,
    track: u32,
    session: u32,
    playlist: u32,
    loops: u16,
    hour: u8,
    weekday: u8,
    reason: u8,
    context: u8,
    origin: u8,
}

const CONTEXTS: [&str; 8] = ["playlist", "album", "artist", "radio", "mix", "search", "local", "other"];
const ORIGINS: [&str; 4] = ["stream", "cache", "local", "other"];

/// The compact copy of `play_events`. Rows are never edited, only added or deleted, so catching up
/// is reading ids above the last one; a delete empties it.
#[derive(Default)]
pub struct History {
    events: Vec<Event>,
    tracks: Interner,
    sessions: Interner,
    playlists: Interner,
    metas: Vec<Option<Meta>>,
    last_id: i64,
    /// Everything is read once: from here on an event also refreshes its track's names.
    caught_up: bool,
}

impl History {
    /// Reads up to `limit` unseen rows. True when none are left, so a warm-up can give way in between.
    pub fn catch_up(&mut self, conn: &Connection, limit: i64) -> Result<bool, StoreError> {
        let mut stmt = conn.prepare_cached(
            "SELECT id, track_id, session_id, started_at, played_ms, end_reason, context, CASE WHEN context = 'playlist' THEN context_id END,
                    loop_count, tz_offset_min, source, hour, weekday
             FROM play_events WHERE id > ?1 ORDER BY id LIMIT ?2",
        )?;
        let mut rows = stmt.query(params![self.last_id, limit])?;
        let mut stale = HashSet::new();
        let mut read = 0;
        while let Some(row) = rows.next()? {
            read += 1;
            let text = |index: usize| -> Result<Option<&str>, StoreError> { Ok(row.get_ref(index)?.as_str_or_null().map_err(rusqlite::Error::from)?) };
            let started_at: i64 = row.get(3)?;
            let context = context_kind(text(6)?);
            let origin = origin_kind(text(10)?);
            let known = self.tracks.ids.len();
            let track = self.tracks.id(text(1)?.unwrap_or_default());
            if self.caught_up || track as usize >= known {
                stale.insert(track);
            }
            self.last_id = row.get(0)?;
            self.events.push(Event {
                started_at,
                played_ms: row.get(4)?,
                day: local_day(started_at, row.get(9)?),
                track,
                session: self.sessions.id(text(2)?.unwrap_or_default()),
                playlist: text(7)?.map_or(NO_PLAYLIST, |id| self.playlists.id(id)),
                loops: row.get::<_, i64>(8)?.clamp(0, i64::from(u16::MAX)) as u16,
                hour: row.get::<_, i64>(11)?.clamp(0, 23) as u8,
                weekday: row.get::<_, i64>(12)?.clamp(0, 6) as u8,
                reason: match text(5)?.unwrap_or_default() {
                    "complete" => REASON_COMPLETE,
                    "skip" => REASON_SKIP,
                    "error" => REASON_ERROR,
                    _ => REASON_OTHER,
                },
                context: CONTEXTS.iter().position(|kind| *kind == context).unwrap_or(CONTEXTS.len() - 1) as u8,
                origin: ORIGINS.iter().position(|kind| *kind == origin).unwrap_or(ORIGINS.len() - 1) as u8,
            });
        }
        drop(rows);
        self.metas.resize_with(self.tracks.ids.len(), || None);
        if !stale.is_empty() {
            let names = self.tracks.in_order();
            for track in stale {
                self.metas[track as usize] = read_meta(conn, names[track as usize])?;
            }
        }
        self.caught_up = read < limit;
        Ok(self.caught_up)
    }
}

/// What a play counts as: a completed or 30 s play is one, a repeat-one play as many as it looped.
fn listens(completed: bool, played_ms: i64, loops: i64) -> i64 {
    if completed || played_ms >= COUNTED_MS { loops.max(1) } else { 0 }
}

/// The page's name for a play's context; the free text older builds stored is `other`.
fn context_kind(kind: Option<&str>) -> &'static str {
    match kind {
        Some("playlist") => "playlist",
        Some("suggest") => "playlist",
        Some("album") => "album",
        Some("artist") => "artist",
        Some("radio") => "radio",
        Some("continue") => "radio",
        Some("mix") => "mix",
        Some("search") => "search",
        Some("local") => "local",
        _ => "other",
    }
}

fn origin_kind(source: Option<&str>) -> &'static str {
    match source {
        Some("local") => "local",
        Some("cache") => "cache",
        Some("youtube" | "soundcloud") => "stream",
        _ => "other",
    }
}

fn shares(map: impl IntoIterator<Item = (&'static str, (i64, i64))>) -> Vec<StatsShare> {
    let mut list: Vec<StatsShare> =
        map.into_iter().filter(|(_, (plays, ms))| *plays > 0 || *ms > 0).map(|(kind, (plays, ms))| StatsShare { kind: kind.to_string(), plays, listened_ms: ms }).collect();
    list.sort_by_key(|share| (Reverse(share.listened_ms), share.kind.clone()));
    list
}

fn rate(part: i64, whole: i64) -> f64 {
    if whole > 0 { part as f64 / whole as f64 } else { 0.0 }
}

/// A stored track's fields for grouping and rows.
struct Meta {
    title: String,
    artist: String,
    album: Option<String>,
    album_id: Option<String>,
    cover_url: Option<String>,
    artists_json: String,
    artist_group: Option<String>,
    album_group: Option<String>,
    genre: Option<String>,
}

fn read_meta(conn: &Connection, id: &str) -> Result<Option<Meta>, StoreError> {
    let mut stmt = conn.prepare_cached(
        "SELECT t.title, t.artist, t.album, t.album_id, t.cover_url, t.artists_json, coalesce(k.artist_key, ''),
                CASE WHEN t.source = 'local' THEN json_extract(t.snapshot_json, '$.local.genre') END
         FROM tracks t LEFT JOIN track_keys k ON k.track_id = t.id WHERE t.id = ?1",
    )?;
    Ok(stmt
        .query_row([id], |r| {
            let artist: String = r.get(1)?;
            let album: Option<String> = r.get(2)?;
            let album_id: Option<String> = r.get(3)?;
            let key: String = r.get(6)?;
            let name = artist.to_lowercase();
            let artist_group = if !key.is_empty() { Some(key) } else { (!name.is_empty()).then(|| format!("name:{name}")) };
            let album_group = album_id.clone().or_else(|| album.as_deref().filter(|a| !a.is_empty()).map(|a| format!("name:{}|{name}", a.to_lowercase())));
            Ok(Meta {
                title: r.get(0)?,
                artist,
                album,
                album_id,
                cover_url: r.get(4)?,
                artists_json: r.get(5)?,
                artist_group,
                album_group,
                genre: r.get::<_, Option<String>>(7)?.map(|g| g.trim().to_string()).filter(|g| !g.is_empty()),
            })
        })
        .optional()?)
}

fn first_artist_id(artists_json: &str) -> Option<String> {
    let artists: Value = serde_json::from_str(artists_json).ok()?;
    artists.get(0)?.get("id")?.as_str().filter(|id| !id.is_empty()).map(str::to_string)
}

/// Tracks of one artist, album or genre added up; the most played track gives the row its face.
struct Group {
    id: String,
    title: String,
    subtitle: Option<String>,
    cover_url: Option<String>,
    open_id: Option<String>,
    now: Tally,
    before: Tally,
    first_day: i64,
    best: i64,
}

impl Group {
    fn new(id: String) -> Self {
        Self { id, title: String::new(), subtitle: None, cover_url: None, open_id: None, now: Tally::default(), before: Tally::default(), first_day: i64::MAX, best: -1 }
    }

    fn add(&mut self, tally: &TrackTally, face: impl FnOnce(&mut Self)) {
        self.now.add(tally.now);
        self.before.add(tally.before);
        self.first_day = self.first_day.min(tally.first_day);
        if tally.now.plays > self.best {
            self.best = tally.now.plays;
            face(self);
        }
    }
}

fn order(left: &Tally, right: &Tally) -> std::cmp::Ordering {
    (right.plays, right.ms).cmp(&(left.plays, left.ms))
}

/// Rows of everything played in the period, best first, with their move since the previous period.
fn ranked(groups: Vec<Group>, has_previous: bool, limit: usize) -> Vec<StatsRow> {
    let mut before: Vec<&Group> = groups.iter().filter(|g| g.before.plays > 0).collect();
    before.sort_by(|a, b| order(&a.before, &b.before).then_with(|| a.id.cmp(&b.id)));
    let earlier: HashMap<&str, i64> = before.iter().enumerate().map(|(index, g)| (g.id.as_str(), index as i64 + 1)).collect();
    let mut now: Vec<&Group> = groups.iter().filter(|g| g.now.plays > 0).collect();
    now.sort_by(|a, b| order(&a.now, &b.now).then_with(|| a.id.cmp(&b.id)));
    now.iter()
        .take(limit)
        .enumerate()
        .map(|(index, g)| {
            let rank = index as i64 + 1;
            let was = earlier.get(g.id.as_str()).copied();
            StatsRow {
                id: g.id.clone(),
                title: g.title.clone(),
                subtitle: g.subtitle.clone(),
                cover_url: g.cover_url.clone(),
                plays: g.now.plays,
                listened_ms: g.now.ms,
                rank,
                rank_delta: was.map(|place| place - rank),
                is_new: has_previous && was.is_none(),
                open_id: g.open_id.clone(),
                ..StatsRow::default()
            }
        })
        .collect()
}

/// The stored snapshots of the track rows, in one go at the end.
fn attach_snapshots<'a>(conn: &Connection, rows: impl Iterator<Item = &'a mut StatsRow>) -> Result<(), StoreError> {
    let mut stmt = conn.prepare_cached("SELECT snapshot_json FROM tracks WHERE id = ?1")?;
    for row in rows {
        let raw: Option<String> = stmt.query_row([&row.id], |r| r.get(0)).optional()?;
        row.track = raw.as_deref().map(tracks::parse).transpose()?;
    }
    Ok(())
}

fn longest_run(active: &[i64]) -> StatsStreak {
    let mut best = StatsStreak::default();
    let mut start = 0;
    for index in 0..active.len() {
        if index > 0 && active[index] != active[index - 1] + 1 {
            start = index;
        }
        let length = (index - start + 1) as i64;
        if length > best.days {
            best = StatsStreak { days: length, from: Some(iso_day(active[start])), to: Some(iso_day(active[index])) };
        }
    }
    best
}

fn current_run(active: &HashSet<i64>, today: i64) -> i64 {
    let mut day = if active.contains(&today) { today } else { today - 1 };
    let mut run = 0;
    while active.contains(&day) {
        run += 1;
        day -= 1;
    }
    run
}

#[derive(Default)]
struct DayTally {
    ms: i64,
    plays: i64,
}

fn totals<'a>(rates: &Rates, tally: impl Iterator<Item = (i64, Option<&'a str>, Option<&'a str>)>, active_days: i64, sessions: i64) -> StatsTotals {
    let mut tracks = 0;
    let mut artists = HashSet::new();
    let mut albums = HashSet::new();
    for (plays, artist, album) in tally {
        if plays > 0 {
            tracks += 1;
            artists.extend(artist);
            albums.extend(album);
        }
    }
    StatsTotals {
        listened_ms: rates.ms,
        plays: rates.plays,
        tracks,
        artists: artists.len() as i64,
        albums: albums.len() as i64,
        active_days,
        sessions,
        skip_rate: rate(rates.skipped, rates.heard),
        completed_rate: rate(rates.completed, rates.heard),
    }
}

pub fn overview(conn: &Connection, history: &mut History, period: Period) -> Result<StatsOverview, StoreError> {
    history.catch_up(conn, i64::MAX)?;
    let Period { from, to, today } = period;
    if let (Some(from), Some(to)) = (from, to)
        && from > to
    {
        return Err(StoreError::Invalid("from is after to".into()));
    }
    let end = to.unwrap_or(today);
    let previous = from.map(|from| (from - (end - from + 1), from - 1));
    let in_now = |day: i64| from.is_none_or(|from| day >= from) && day <= end;
    let in_before = |day: i64| previous.is_some_and(|(first, last)| day >= first && day <= last);

    let mut tallies = vec![TrackTally::default(); history.tracks.ids.len()];
    let mut days: HashMap<i64, DayTally> = HashMap::new();
    let mut now = Rates::default();
    let mut before = Rates::default();
    let mut by_hour = [0i64; 24];
    let mut by_weekday = [0i64; 7];
    let mut sources = [(0i64, 0i64); CONTEXTS.len()];
    let mut origins = [(0i64, 0i64); ORIGINS.len()];
    let mut playlists: HashMap<u32, (Tally, Tally)> = HashMap::new();
    let mut sessions: HashMap<u32, Session> = HashMap::new();
    let mut sessions_before: HashSet<u32> = HashSet::new();
    let mut first_ms = i64::MAX;
    let mut first_day = i64::MAX;

    for event in &history.events {
        let Event { started_at, played_ms, day, session, .. } = *event;
        let loops = i64::from(event.loops);
        let plays = listens(event.reason == REASON_COMPLETE, played_ms, loops);
        let tally = &mut tallies[event.track as usize];
        tally.last_ms = tally.last_ms.max(started_at);
        first_ms = first_ms.min(started_at);
        first_day = first_day.min(day);
        let entry = days.entry(day).or_default();
        entry.ms += played_ms;
        if plays > 0 {
            if started_at < tally.first_ms {
                tally.first_ms = started_at;
                tally.first_day = day;
            }
            tally.all_plays += plays;
            entry.plays += plays;
            if day > end - REPEAT_WINDOW_DAYS && day <= end {
                tally.recent_plays += plays;
            }
        }

        let (is_now, is_before) = (in_now(day), in_before(day));
        if !is_now && !is_before {
            continue;
        }
        let skipped = event.reason == REASON_SKIP && played_ms > 0;
        let heard = event.reason != REASON_ERROR && !(event.reason == REASON_SKIP && played_ms == 0);
        let rates = if is_now { &mut now } else { &mut before };
        rates.ms += played_ms;
        rates.plays += plays;
        rates.heard += i64::from(heard);
        rates.skipped += i64::from(skipped);
        rates.completed += i64::from(event.reason == REASON_COMPLETE);

        let replays = (loops - 1).max(0) + i64::from(plays > 0 && tally.last_session == session);
        let change = Tally { plays, ms: played_ms, skips: i64::from(skipped), replays };
        if plays > 0 {
            tally.last_session = session;
        }
        if is_now { tally.now.add(change) } else { tally.before.add(change) }

        if event.playlist != NO_PLAYLIST {
            let pair = playlists.entry(event.playlist).or_default();
            if is_now { pair.0.add(change) } else { pair.1.add(change) }
        }
        if !is_now {
            if plays > 0 {
                sessions_before.insert(session);
            }
            continue;
        }
        by_hour[usize::from(event.hour)] += played_ms;
        by_weekday[usize::from(event.weekday)] += played_ms;
        let share = &mut sources[usize::from(event.context)];
        share.0 += plays;
        share.1 += played_ms;
        let share = &mut origins[usize::from(event.origin)];
        share.0 += plays;
        share.1 += played_ms;
        let open = sessions.entry(session).or_insert(Session { ms: 0, started_at, counted: 0 });
        open.ms += played_ms;
        open.started_at = open.started_at.min(started_at);
        open.counted += plays;
    }

    let ids = history.tracks.in_order();
    let metas = &history.metas;

    let mut artists: HashMap<&str, Group> = HashMap::new();
    let mut albums: HashMap<&str, Group> = HashMap::new();
    let mut genres: HashMap<String, Group> = HashMap::new();
    let mut track_groups = Vec::new();
    for (index, tally) in tallies.iter().enumerate() {
        let Some(meta) = &metas[index] else { continue };
        if let Some(key) = &meta.artist_group {
            artists.entry(key).or_insert_with(|| Group::new(key.clone())).add(tally, |g| {
                g.title.clone_from(&meta.artist);
                g.cover_url.clone_from(&meta.cover_url);
                g.open_id = first_artist_id(&meta.artists_json);
            });
        }
        if let Some(key) = &meta.album_group {
            albums.entry(key).or_insert_with(|| Group::new(key.clone())).add(tally, |g| {
                g.title = meta.album.clone().unwrap_or_default();
                g.subtitle = Some(meta.artist.clone());
                g.cover_url.clone_from(&meta.cover_url);
                g.open_id.clone_from(&meta.album_id);
            });
        }
        if let Some(genre) = &meta.genre {
            let key = genre.to_lowercase();
            genres.entry(key.clone()).or_insert_with(|| Group::new(key)).add(tally, |g| {
                g.title = genre.clone();
                g.cover_url.clone_from(&meta.cover_url);
            });
        }
        if tally.now.plays == 0 && tally.before.plays == 0 {
            continue;
        }
        let mut group = Group::new(ids[index].to_string());
        group.title.clone_from(&meta.title);
        group.subtitle = Some(meta.artist.clone());
        group.cover_url.clone_from(&meta.cover_url);
        group.now = tally.now;
        group.before = tally.before;
        track_groups.push(group);
    }

    let new_artists = artists.values().filter(|g| g.now.plays > 0 && in_now(g.first_day)).count() as i64;

    let mut active: Vec<i64> = days.iter().filter(|(_, tally)| tally.plays > 0).map(|(day, _)| *day).collect();
    active.sort_unstable();
    let active_set: HashSet<i64> = active.iter().copied().collect();
    let active_now: Vec<i64> = active.iter().copied().filter(|day| in_now(*day)).collect();
    let active_before = active.iter().filter(|day| in_before(**day)).count() as i64;

    let group_keys = |tally_of: fn(&TrackTally) -> i64| {
        tallies.iter().zip(metas).map(move |(tally, meta)| {
            let meta = meta.as_ref();
            (tally_of(tally), meta.and_then(|m| m.artist_group.as_deref()), meta.and_then(|m| m.album_group.as_deref()))
        })
    };
    let counted_sessions: Vec<&Session> = sessions.values().filter(|session| session.counted > 0).collect();
    let this_period = totals(&now, group_keys(|t| t.now.plays), active_now.len() as i64, counted_sessions.len() as i64);
    let last_period = previous.map(|_| totals(&before, group_keys(|t| t.before.plays), active_before, sessions_before.len() as i64));

    let session_rows = {
        let longest = counted_sessions.iter().max_by_key(|session| session.ms);
        let total: i64 = counted_sessions.iter().map(|session| session.ms).sum();
        StatsSessions {
            count: counted_sessions.len() as i64,
            average_ms: if counted_sessions.is_empty() { 0 } else { total / counted_sessions.len() as i64 },
            longest_ms: longest.map_or(0, |session| session.ms),
            longest_started_at: longest.map(|session| iso_from_ms(session.started_at)),
            longest_tracks: longest.map_or(0, |session| session.counted),
        }
    };

    // with nothing played before there is nothing to be new against
    let has_previous = previous.is_some() && before.plays > 0;
    let mut top_tracks = ranked(track_groups, has_previous, TOP_ROWS);
    let track_row = |index: usize| -> Option<StatsRow> {
        let meta = metas[index].as_ref()?;
        let tally = &tallies[index];
        Some(StatsRow {
            id: ids[index].to_string(),
            title: meta.title.clone(),
            subtitle: Some(meta.artist.clone()),
            cover_url: meta.cover_url.clone(),
            plays: tally.now.plays,
            listened_ms: tally.now.ms,
            ..StatsRow::default()
        })
    };
    let picked = |keep: &dyn Fn(&TrackTally) -> bool, key: &dyn Fn(&TrackTally) -> (i64, i64)| -> Vec<usize> {
        let mut list: Vec<usize> = (0..tallies.len()).filter(|index| metas[*index].is_some() && keep(&tallies[*index])).collect();
        list.sort_by_key(|index| (Reverse(key(&tallies[*index])), ids[*index]));
        list.truncate(SIDE_ROWS);
        list
    };
    let numbered = |list: Vec<StatsRow>| -> Vec<StatsRow> {
        list.into_iter().enumerate().map(|(index, row)| StatsRow { rank: index as i64 + 1, ..row }).collect()
    };

    let mut most_skipped = numbered(
        picked(&|t| t.now.skips >= MOST_SKIPPED_MIN, &|t| (t.now.skips, t.now.plays))
            .into_iter()
            .filter_map(|index| Some(StatsRow { skips: Some(tallies[index].now.skips), ..track_row(index)? }))
            .collect(),
    );
    let mut most_replayed = numbered(
        picked(&|t| t.now.replays > 0, &|t| (t.now.replays, t.now.plays))
            .into_iter()
            .filter_map(|index| Some(StatsRow { replays: Some(tallies[index].now.replays), ..track_row(index)? }))
            .collect(),
    );
    let mut on_repeat = numbered(
        picked(&|t| t.recent_plays >= REPEAT_MIN_PLAYS, &|t| (t.recent_plays, t.last_ms))
            .into_iter()
            .filter_map(|index| Some(StatsRow { plays: tallies[index].recent_plays, ..track_row(index)? }))
            .collect(),
    );
    let mut discoveries = numbered(
        picked(&|t| t.now.plays > 0 && in_now(t.first_day), &|t| (t.now.plays, t.first_ms))
            .into_iter()
            .filter_map(|index| Some(StatsRow { first_played_at: Some(iso_from_ms(tallies[index].first_ms)), ..track_row(index)? }))
            .collect(),
    );
    let silent_from = (today - FORGOTTEN_SILENT_DAYS) * DAY_MS;
    let mut forgotten = numbered(
        picked(&|t| t.all_plays >= FORGOTTEN_MIN_PLAYS && t.last_ms < silent_from, &|t| (t.all_plays, t.last_ms))
            .into_iter()
            .filter_map(|index| {
                let tally = &tallies[index];
                Some(StatsRow { plays: tally.all_plays, last_played_at: Some(iso_from_ms(tally.last_ms)), ..track_row(index)? })
            })
            .collect(),
    );
    attach_snapshots(
        conn,
        top_tracks
            .iter_mut()
            .chain(&mut most_skipped)
            .chain(&mut most_replayed)
            .chain(&mut on_repeat)
            .chain(&mut discoveries)
            .chain(&mut forgotten),
    )?;

    let new_tracks = tallies.iter().filter(|t| t.now.plays > 0 && in_now(t.first_day)).count() as i64;

    let mut day_rows: Vec<(i64, &DayTally)> = days.iter().map(|(day, tally)| (*day, tally)).collect();
    day_rows.sort_unstable_by_key(|(day, _)| *day);
    let day_row = |(day, tally): &(i64, &DayTally)| StatsDay { day: iso_day(*day), listened_ms: tally.ms, plays: tally.plays };
    let start = from.unwrap_or(if first_day == i64::MAX { end } else { first_day });

    Ok(StatsOverview {
        range: StatsRange {
            from: (from.is_some() || first_day != i64::MAX).then(|| iso_day(start)),
            to: iso_day(end),
            days: end - start + 1,
            previous_from: previous.map(|(first, _)| iso_day(first)),
            previous_to: previous.map(|(_, last)| iso_day(last)),
        },
        totals: this_period,
        previous: last_period,
        new_tracks,
        new_artists,
        current_streak: current_run(&active_set, today),
        longest_streak: longest_run(&active_now),
        first_played_at: (first_ms != i64::MAX).then(|| iso_from_ms(first_ms)),
        days: day_rows.iter().filter(|(day, _)| in_now(*day)).map(day_row).collect(),
        calendar: day_rows.iter().filter(|(day, _)| *day > end - CALENDAR_DAYS && *day <= end).map(day_row).collect(),
        by_hour: by_hour.to_vec(),
        by_weekday: by_weekday.to_vec(),
        sources: shares(CONTEXTS.into_iter().zip(sources)),
        origins: shares(ORIGINS.into_iter().zip(origins)),
        sessions: session_rows,
        top: StatsTop {
            tracks: top_tracks,
            artists: ranked(artists.into_values().collect(), has_previous, TOP_ROWS),
            albums: ranked(albums.into_values().collect(), has_previous, TOP_ROWS),
            playlists: playlist_rows(conn, playlists, &history.playlists.in_order(), has_previous)?,
            genres: ranked(genres.into_values().collect(), has_previous, SIDE_ROWS),
        },
        most_skipped,
        most_replayed,
        on_repeat,
        discoveries,
        forgotten,
    })
}

fn playlist_rows(conn: &Connection, playlists: HashMap<u32, (Tally, Tally)>, ids: &[&str], has_previous: bool) -> Result<Vec<StatsRow>, StoreError> {
    let mut stmt = conn.prepare_cached("SELECT title, cover_url FROM playlists WHERE id = ?1")?;
    let mut groups = Vec::new();
    for (index, (now, before)) in playlists {
        let id = ids[index as usize].to_string();
        let found: Option<(String, Option<String>)> = stmt.query_row([&id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        // the liked list has no row of its own, the page names it; a playlist deleted since stays out
        if found.is_none() && id != "likes" {
            continue;
        }
        let (title, cover_url) = found.unwrap_or_default();
        let mut group = Group::new(id);
        group.title = title;
        group.cover_url = cover_url;
        group.now = now;
        group.before = before;
        groups.push(group);
    }
    Ok(ranked(groups, has_previous, SIDE_ROWS))
}

struct DetailTally {
    first_ms: i64,
    last_ms: i64,
    plays: i64,
    ms: i64,
    skips: i64,
    completed: i64,
    days: HashSet<i64>,
    months: BTreeMap<i64, (i64, i64, String)>,
    by_hour: [i64; 24],
    by_weekday: [i64; 7],
    sources: HashMap<&'static str, (i64, i64)>,
}

impl Default for DetailTally {
    fn default() -> Self {
        Self {
            first_ms: i64::MAX,
            last_ms: i64::MIN,
            plays: 0,
            ms: 0,
            skips: 0,
            completed: 0,
            days: HashSet::new(),
            months: BTreeMap::new(),
            by_hour: [0; 24],
            by_weekday: [0; 7],
            sources: HashMap::new(),
        }
    }
}

impl DetailTally {
    fn add(&mut self, row: &Row) -> Result<i64, StoreError> {
        let started_at: i64 = row.get(0)?;
        let played_ms: i64 = row.get(1)?;
        let reason: String = row.get(2)?;
        let loops: i64 = row.get(3)?;
        let context: Option<String> = row.get(4)?;
        let day = local_day(started_at, row.get(5)?);
        let hour = row.get::<_, i64>(6)?.clamp(0, 23) as usize;
        let weekday = row.get::<_, i64>(7)?.clamp(0, 6) as usize;
        let plays = listens(reason == "complete", played_ms, loops);
        self.first_ms = self.first_ms.min(started_at);
        self.last_ms = self.last_ms.max(started_at);
        self.plays += plays;
        self.ms += played_ms;
        self.skips += i64::from(reason == "skip" && played_ms > 0);
        self.completed += i64::from(reason == "complete");
        if plays > 0 {
            self.days.insert(day);
        }
        // a month is one bucket per calendar month, keyed by its sortable text
        let month_text = iso_day(day)[..7].to_string();
        let month_key = month_text.replace('-', "").parse::<i64>().unwrap_or_default();
        let month = self.months.entry(month_key).or_insert((0, 0, month_text));
        month.0 += plays;
        month.1 += played_ms;
        self.by_hour[hour] += played_ms;
        self.by_weekday[weekday] += played_ms;
        let share = self.sources.entry(context_kind(context.as_deref())).or_default();
        share.0 += plays;
        share.1 += played_ms;
        Ok(plays)
    }

    fn into_detail(self, title: String, subtitle: Option<String>, cover_url: Option<String>, track: Option<Value>, open_id: Option<String>, top_tracks: Vec<StatsRow>) -> StatsDetail {
        let seen = self.first_ms != i64::MAX;
        StatsDetail {
            title,
            subtitle,
            cover_url,
            track,
            open_id,
            first_played_at: seen.then(|| iso_from_ms(self.first_ms)),
            last_played_at: seen.then(|| iso_from_ms(self.last_ms)),
            plays: self.plays,
            listened_ms: self.ms,
            skips: self.skips,
            completed: self.completed,
            active_days: self.days.len() as i64,
            by_month: self.months.into_values().map(|(plays, listened_ms, month)| StatsMonth { month, plays, listened_ms }).collect(),
            by_hour: self.by_hour.to_vec(),
            by_weekday: self.by_weekday.to_vec(),
            sources: shares(self.sources),
            top_tracks,
        }
    }
}

const DETAIL_COLUMNS: &str = "e.started_at, e.played_ms, e.end_reason, e.loop_count, e.context, e.tz_offset_min, e.hour, e.weekday";

/// One track's whole history; `NotFound` when the daemon has never stored it.
pub fn track_detail(conn: &Connection, id: &str) -> Result<StatsDetail, StoreError> {
    let (title, artist, cover_url, raw): (String, String, Option<String>, String) = conn
        .query_row("SELECT title, artist, cover_url, snapshot_json FROM tracks WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()?
        .ok_or(StoreError::NotFound("track"))?;
    let mut tally = DetailTally::default();
    let mut stmt = conn.prepare_cached(&format!("SELECT {DETAIL_COLUMNS} FROM play_events e WHERE e.track_id = ?1"))?;
    let mut rows = stmt.query([id])?;
    while let Some(row) = rows.next()? {
        tally.add(row)?;
    }
    Ok(tally.into_detail(title, Some(artist), cover_url, Some(tracks::parse(&raw)?), None, Vec::new()))
}

/// One artist's whole history by `track_keys.artist_key`, or by the plain name for a `name:` key.
pub fn artist_detail(conn: &Connection, key: &str) -> Result<StatsDetail, StoreError> {
    let track_ids: Vec<String> = match key.strip_prefix("name:") {
        Some(name) => {
            let mut stmt = conn.prepare_cached("SELECT id FROM tracks WHERE nuvo_fold(artist) = ?1")?;
            stmt.query_map([name], |r| r.get(0))?.collect::<Result<_, _>>()?
        }
        None => {
            let mut stmt = conn.prepare_cached("SELECT track_id FROM track_keys WHERE artist_key = ?1")?;
            stmt.query_map([key], |r| r.get(0))?.collect::<Result<_, _>>()?
        }
    };
    let mut tally = DetailTally::default();
    let mut groups = Vec::new();
    let mut stmt = conn.prepare_cached(&format!("SELECT {DETAIL_COLUMNS} FROM play_events e WHERE e.track_id = ?1"))?;
    for id in &track_ids {
        let mut plays = 0;
        let mut ms = 0;
        let mut rows = stmt.query([id])?;
        while let Some(row) = rows.next()? {
            plays += tally.add(row)?;
            ms += row.get::<_, i64>(1)?;
        }
        groups.push((id.as_str(), plays, ms));
    }
    if tally.first_ms == i64::MAX {
        return Err(StoreError::NotFound("artist"));
    }
    groups.sort_by_key(|(id, plays, ms)| (Reverse(*plays), Reverse(*ms), *id));
    let ranked_ids: Vec<&str> = groups.iter().filter(|(_, plays, _)| *plays > 0).take(SIDE_ROWS).map(|(id, _, _)| *id).collect();
    let metas = ranked_ids.iter().map(|id| read_meta(conn, id)).collect::<Result<Vec<_>, _>>()?;
    let mut top: Vec<StatsRow> = groups
        .iter()
        .zip(&metas)
        .enumerate()
        .filter_map(|(index, ((id, plays, ms), meta))| {
            let meta = meta.as_ref()?;
            Some(StatsRow {
                id: id.to_string(),
                title: meta.title.clone(),
                subtitle: Some(meta.artist.clone()),
                cover_url: meta.cover_url.clone(),
                plays: *plays,
                listened_ms: *ms,
                rank: index as i64 + 1,
                ..StatsRow::default()
            })
        })
        .collect();
    attach_snapshots(conn, top.iter_mut())?;
    let lead = metas.iter().flatten().next();
    let title = lead.map(|meta| meta.artist.clone()).unwrap_or_default();
    let cover = lead.and_then(|meta| meta.cover_url.clone());
    let open_id = lead.and_then(|meta| first_artist_id(&meta.artists_json));
    Ok(tally.into_detail(title, None, cover, None, open_id, top))
}

/// One event of an export, with the names the track had when it was last stored.
pub struct ExportEvent {
    pub started_at: i64,
    pub local_day: i64,
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub played_ms: i64,
    pub duration_ms: Option<i64>,
    pub end_reason: String,
    pub context: Option<String>,
    pub context_id: Option<String>,
    pub source: Option<String>,
    pub session_id: String,
    pub loop_count: i64,
}

fn day_bounds(range: Option<(i64, i64)>) -> (Option<i64>, Option<i64>) {
    range.map_or((None, None), |(from, to)| (Some(from * DAY_MS), Some((to + 1) * DAY_MS)))
}

const IN_RANGE: &str = "(?1 IS NULL OR e.started_at - e.tz_offset_min * 60000 >= ?1) AND (?2 IS NULL OR e.started_at - e.tz_offset_min * 60000 < ?2)";

/// Every event of the local days in `range`, oldest first; `None` is everything.
pub fn export_events(conn: &Connection, range: Option<(i64, i64)>) -> Result<Vec<ExportEvent>, StoreError> {
    let (from, to) = day_bounds(range);
    let mut stmt = conn.prepare(&format!(
        "SELECT e.started_at, e.tz_offset_min, e.track_id, coalesce(t.title, ''), coalesce(t.artist, ''), t.album, e.played_ms, e.duration_ms,
                e.end_reason, e.context, e.context_id, e.source, e.session_id, e.loop_count
         FROM play_events e LEFT JOIN tracks t ON t.id = e.track_id WHERE {IN_RANGE} ORDER BY e.started_at, e.id"
    ))?;
    let rows = stmt.query_map(params![from, to], |r| {
        let started_at: i64 = r.get(0)?;
        Ok(ExportEvent {
            started_at,
            local_day: local_day(started_at, r.get(1)?),
            track_id: r.get(2)?,
            title: r.get(3)?,
            artist: r.get(4)?,
            album: r.get(5)?,
            played_ms: r.get(6)?,
            duration_ms: r.get(7)?,
            end_reason: r.get(8)?,
            context: r.get(9)?,
            context_id: r.get(10)?,
            source: r.get(11)?,
            session_id: r.get(12)?,
            loop_count: r.get(13)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Deletes the events of the local days in `range` (`None` is everything) and what only they left
/// behind (the caller drops its `History`): pending scrobbles, automatic scrub-skip penalties and tracks nothing else refers to.
/// Everything else recommendations use is read live from `play_events`, so they follow by themselves.
pub fn delete(conn: &Connection, range: Option<(i64, i64)>) -> Result<i64, StoreError> {
    let (from, to) = day_bounds(range);
    conn.execute_batch("PRAGMA secure_delete = ON")?;
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS stats_doomed (id INTEGER PRIMARY KEY, track_id TEXT NOT NULL, started_at INTEGER NOT NULL);
         DELETE FROM temp.stats_doomed;",
    )?;
    tx.execute(&format!("INSERT INTO temp.stats_doomed SELECT e.id, e.track_id, e.started_at FROM play_events e WHERE {IN_RANGE}"), params![from, to])?;
    let events = tx.execute("DELETE FROM play_events WHERE id IN (SELECT id FROM temp.stats_doomed)", [])? as i64;
    tx.execute("DELETE FROM scrobble_queue WHERE played_at IN (SELECT started_at / 1000 FROM temp.stats_doomed)", [])?;
    tx.execute("DELETE FROM suppressions WHERE origin = 'scrub_skip' AND created_at IN (SELECT started_at FROM temp.stats_doomed)", [])?;
    if range.is_none() {
        tx.execute("DELETE FROM rec_model", [])?;
    }
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS stats_orphans (id TEXT PRIMARY KEY);
         DELETE FROM temp.stats_orphans;
         INSERT OR IGNORE INTO temp.stats_orphans SELECT d.track_id FROM temp.stats_doomed d
           WHERE NOT EXISTS(SELECT 1 FROM play_events e WHERE e.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM liked_tracks x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM playlist_items x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM local_files x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM track_trims x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM download_items x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM suppressions x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM cache_entries x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM candidate_edges x WHERE x.track_id = d.track_id OR x.seed_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM served x WHERE x.track_id = d.track_id)
             AND NOT EXISTS(SELECT 1 FROM rec_starters x WHERE x.track_id = d.track_id);
         DELETE FROM track_keys WHERE track_id IN (SELECT id FROM temp.stats_orphans);
         DELETE FROM tracks WHERE id IN (SELECT id FROM temp.stats_orphans);
         DROP TABLE temp.stats_orphans;
         DROP TABLE temp.stats_doomed;",
    )?;
    tx.commit()?;
    // the deleted pages are zeroed in the file, and the log that still held them goes
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA secure_delete = OFF;")?;
    Ok(events)
}

/// Plays per list, album or artist page they were started from (completed or 30 s), with the last one.
pub fn context_plays(conn: &Connection) -> Result<Vec<StatsContextPlays>, StoreError> {
    let mut stmt = conn.prepare_cached(
        "SELECT context, context_id, COUNT(*), MAX(started_at) FROM play_events
         WHERE context IN ('playlist', 'album', 'artist') AND context_id IS NOT NULL
           AND (end_reason = 'complete' OR played_ms >= ?1)
         GROUP BY context, context_id",
    )?;
    let rows = stmt.query_map([COUNTED_MS], |r| {
        Ok(StatsContextPlays { kind: r.get(0)?, id: r.get(1)?, plays: r.get(2)?, last_played_at: iso_from_ms(r.get(3)?) })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn collection_paused(conn: &Connection) -> Result<bool, StoreError> {
    Ok(settings::get(conn, settings::STATS_PAUSED)?.and_then(|value| value.as_bool()).unwrap_or(false))
}

pub fn set_collection_paused(conn: &Connection, paused: bool) -> Result<(), StoreError> {
    settings::set(conn, settings::STATS_PAUSED, &json!(paused))
}
