use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_ROWS: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceRow {
    pub title: String,
    #[serde(default)]
    pub artists: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isrc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub source_kind: &'static str,
    pub label: String,
    pub liked: bool,
    pub rows: Vec<SourceRow>,
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ParseError {
    #[error("the file is larger than 10 MB")]
    TooLarge,
    #[error("the file has more than 20,000 rows")]
    TooManyRows,
    #[error("{0}")]
    Unreadable(String),
}

fn unreadable(reason: &str) -> ParseError {
    ParseError::Unreadable(reason.to_string())
}

fn decode_text(bytes: &[u8]) -> Result<String, ParseError> {
    if bytes.starts_with(b"\xff\xfe") {
        utf16le_to_string(&bytes[2..])
    } else if bytes.starts_with(b"\xfe\xff") {
        utf16be_to_string(&bytes[2..])
    } else {
        std::str::from_utf8(bytes).map(|s| s.strip_prefix('\u{feff}').unwrap_or(s).to_string()).map_err(|_| unreadable("the file is not valid UTF-8 or UTF-16 text"))
    }
}

fn utf16le_to_string(bytes: &[u8]) -> Result<String, ParseError> {
    if !bytes.len().is_multiple_of(2) {
        return Err(unreadable("UTF-16 LE file has odd byte count"));
    }
    let mut result = String::new();
    for i in (0..bytes.len()).step_by(2) {
        let code = u16::from_le_bytes([bytes[i], bytes[i + 1]]);
        if let Some(c) = char::from_u32(code as u32) {
            result.push(c);
        } else {
            return Err(unreadable("invalid UTF-16 LE sequence"));
        }
    }
    Ok(result)
}

fn utf16be_to_string(bytes: &[u8]) -> Result<String, ParseError> {
    if !bytes.len().is_multiple_of(2) {
        return Err(unreadable("UTF-16 BE file has odd byte count"));
    }
    let mut result = String::new();
    for i in (0..bytes.len()).step_by(2) {
        let code = u16::from_be_bytes([bytes[i], bytes[i + 1]]);
        if let Some(c) = char::from_u32(code as u32) {
            result.push(c);
        } else {
            return Err(unreadable("invalid UTF-16 BE sequence"));
        }
    }
    Ok(result)
}

pub fn parse_file(name: &str, bytes: &[u8]) -> Result<Vec<Parsed>, ParseError> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(ParseError::TooLarge);
    }
    let text = decode_text(bytes)?;
    let stem = name.rsplit('/').next().unwrap_or(name);
    let (stem, extension) = stem.rsplit_once('.').unwrap_or((stem, ""));
    Ok(match extension.to_ascii_lowercase().as_str() {
        "csv" => parse_csv(stem, &text)?,
        "m3u" | "m3u8" => vec![parse_m3u(stem, &text)?],
        "json" => parse_json(stem, &text)?,
        "xspf" => vec![parse_xspf(stem, &text)?],
        "txt" => vec![parse_txt(stem, &text)?],
        _ => return Err(unreadable("pick a .csv, .json, .m3u, .m3u8, .xspf or .txt file")),
    })
}

pub fn csv_records(text: &str) -> Result<Vec<Vec<String>>, ParseError> {
    let (mut records, mut record, mut field) = (Vec::new(), Vec::new(), String::new());
    let (mut quoted, mut chars) = (false, text.chars().peekable());
    while let Some(c) = chars.next() {
        if records.len() > MAX_ROWS {
            return Err(ParseError::TooManyRows);
        }
        match (quoted, c) {
            (true, '"') if chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            (true, '"') => quoted = false,
            (true, c) => field.push(c),
            (false, '"') if field.is_empty() => quoted = true,
            (false, ',') => record.push(std::mem::take(&mut field)),
            (false, '\r') => if chars.peek() != Some(&'\n') && chars.peek() != Some(&'\r') {
                record.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut record));
            },
            (false, '\n') => {
                record.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut record));
            }
            (false, c) => field.push(c),
        }
    }
    if !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
    }
    records.retain(|r| r.iter().any(|f| !f.trim().is_empty()));
    if records.len() > MAX_ROWS {
        return Err(ParseError::TooManyRows);
    }
    Ok(records)
}

// The whole string plus each part, so an artist with a comma in the name still matches
pub fn artist_list(text: &str) -> Vec<String> {
    let whole = text.trim();
    if whole.is_empty() {
        return Vec::new();
    }
    let parts: Vec<String> = whole.split([',', ';']).map(str::trim).filter(|p| !p.is_empty()).map(String::from).collect();
    let mut artists = vec![whole.to_string()];
    if parts.len() > 1 {
        artists.extend(parts);
    }
    artists
}

fn duration_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    if let Some(seconds) = text.strip_suffix('s') {
        return duration_ms(seconds).and_then(|s| s.checked_mul(1000));
    }
    if let Some((minutes, seconds)) = text.split_once(':') {
        let min = minutes.parse::<i64>().ok()?;
        let sec = seconds.parse::<f64>().ok()?;
        if !sec.is_finite() || sec < 0.0 {
            return None;
        }
        let sec_ms = (sec * 1000.0).round() as i64;
        let ms = min.checked_mul(60_000)?.checked_add(sec_ms)?;
        return (ms > 0).then_some(ms);
    }
    let parsed = text.parse::<f64>().ok()?;
    if !parsed.is_finite() || !(0.0..=1e15).contains(&parsed) {
        return None;
    }
    let ms = parsed.round() as i64;
    (ms > 0).then_some(ms)
}

pub fn parse_csv(label: &str, text: &str) -> Result<Vec<Parsed>, ParseError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = csv_records(text)?.into_iter();
    let header: Vec<String> = records.next().ok_or_else(|| unreadable("the CSV is empty"))?.iter().map(|h| h.trim().to_lowercase()).collect();
    let column = |aliases: &[&str]| header.iter().position(|h| aliases.contains(&h.as_str()));
    let Some(title) = column(&["track name", "name", "title"]) else {
        return Ok(vec![parse_takeout(label, records)?]);
    };
    let artists = column(&["artist name(s)", "artist names", "artist name", "artist", "artists"]);
    let album = column(&["album name", "album"]);
    let duration = column(&["duration (ms)", "duration_ms", "duration"]);
    let isrc = column(&["isrc"]);
    let playlist = column(&["playlist name"]);
    let cell = |record: &[String], index: Option<usize>| index.and_then(|i| record.get(i)).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let mut lists: Vec<Parsed> = Vec::new();
    for record in records {
        let Some(title) = cell(&record, Some(title)) else { continue };
        let row = SourceRow {
            title,
            artists: cell(&record, artists).map(|a| artist_list(&a)).unwrap_or_default(),
            album: cell(&record, album),
            duration_ms: cell(&record, duration).and_then(|d| duration_ms(&d)),
            isrc: cell(&record, isrc),
            track: None,
            path: None,
        };
        let name = cell(&record, playlist).unwrap_or_else(|| label.to_string());
        match lists.iter_mut().find(|p| p.label == name) {
            Some(list) => list.rows.push(row),
            None => lists.push(Parsed { source_kind: "spotify-csv", label: name, liked: false, rows: vec![row] }),
        }
    }
    if lists.is_empty() {
        lists.push(Parsed { source_kind: "spotify-csv", label: label.to_string(), liked: false, rows: Vec::new() });
    }
    Ok(lists)
}

// Google Takeout names its columns in the account language, so its files are read by shape: a video id first
fn parse_takeout(label: &str, records: impl Iterator<Item = Vec<String>>) -> Result<Parsed, ParseError> {
    let mut rows = Vec::new();
    for record in records {
        let Some(id) = record.first().map(|c| c.trim()).filter(|c| is_video_id(c)) else { continue };
        let field = |i: usize| record.get(i).map(|c| c.trim()).filter(|c| !c.is_empty() && record.len() > 2);
        let title = field(1).unwrap_or(id).to_string();
        let artists: Vec<String> = (3..record.len()).filter_map(field).map(String::from).collect();
        let album = field(2).map(String::from);
        let track = youtube_track(id, &title, &artists, album.as_deref(), None);
        rows.push(SourceRow { title, artists, album, track: Some(track), ..Default::default() });
    }
    if rows.is_empty() {
        return Err(unreadable("the CSV has no Track Name column"));
    }
    Ok(Parsed { source_kind: "youtube-takeout", label: label.strip_suffix("-videos").unwrap_or(label).to_string(), liked: false, rows })
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

pub fn parse_json(label: &str, text_in: &str) -> Result<Vec<Parsed>, ParseError> {
    let doc: Value = serde_json::from_str(text_in).map_err(|_| unreadable("the file is not valid JSON"))?;
    if let Some(tracks) = doc.as_array() {
        if tracks.len() > MAX_ROWS {
            return Err(ParseError::TooManyRows);
        }
        let rows = tracks
            .iter()
            .filter_map(|t| {
                Some(SourceRow {
                    title: text(t, "title")?,
                    artists: text(t, "artist").map(|a| artist_list(&a)).unwrap_or_default(),
                    album: text(t, "album"),
                    duration_ms: text(t, "duration").and_then(|d| duration_ms(&format!("{d}s"))),
                    isrc: text(t, "isrc"),
                    ..Default::default()
                })
            })
            .collect();
        return Ok(vec![Parsed { source_kind: "json-list", label: label.to_string(), liked: false, rows }]);
    }
    if doc.get("format").and_then(Value::as_str) == Some("nuvo-playlist") {
        return Ok(vec![parse_nuvo(&doc)?]);
    }
    if doc.get("format").and_then(Value::as_str) == Some("nuvo-library") {
        return parse_nuvo_library(&doc);
    }
    if let Some(tracks) = doc.get("tracks").and_then(Value::as_array) {
        let mut rows = Vec::new();
        for t in tracks {
            if rows.len() > MAX_ROWS {
                return Err(ParseError::TooManyRows);
            }
            if let Some(title) = text(t, "track") {
                rows.push(SourceRow {
                    title,
                    artists: text(t, "artist").map(|a| artist_list(&a)).unwrap_or_default(),
                    album: text(t, "album"),
                    ..Default::default()
                });
            }
        }
        return Ok(vec![Parsed { source_kind: "spotify-library", label: "Liked songs".into(), liked: true, rows }]);
    }
    if let Some(playlists) = doc.get("playlists").and_then(Value::as_array) {
        let mut parsed_list = Vec::new();
        for p in playlists {
            let mut rows = Vec::new();
            if let Some(items) = p.get("items").and_then(Value::as_array) {
                for item in items {
                    if rows.len() > MAX_ROWS {
                        return Err(ParseError::TooManyRows);
                    }
                    if let Some(track) = item.get("track").filter(|t| t.is_object())
                        && let Some(title) = text(track, "trackName")
                    {
                        rows.push(SourceRow {
                            title,
                            artists: text(track, "artistName").map(|a| artist_list(&a)).unwrap_or_default(),
                            album: text(track, "albumName"),
                            ..Default::default()
                        });
                    }
                }
            }
            parsed_list.push(Parsed { source_kind: "spotify-playlist", label: text(p, "name").unwrap_or_else(|| "Spotify playlist".into()), liked: false, rows });
        }
        return Ok(parsed_list);
    }
    Err(unreadable("this JSON is neither a Spotify export nor a Nuvo playlist"))
}

fn parse_nuvo(doc: &Value) -> Result<Parsed, ParseError> {
    if doc.get("version").and_then(Value::as_i64) != Some(1) {
        return Err(unreadable("the Nuvo playlist version must be 1"));
    }
    let tracks = doc.get("tracks").and_then(Value::as_array).ok_or_else(|| unreadable("the Nuvo playlist has no tracks"))?;
    let mut rows = Vec::new();
    for t in tracks {
        if rows.len() > MAX_ROWS {
            return Err(ParseError::TooManyRows);
        }
        if let Some(_id) = t.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()) {
            rows.push(SourceRow {
                title: text(t, "title").unwrap_or_default(),
                artists: t.get("artists").and_then(Value::as_array).into_iter().flatten().filter_map(|a| text(a, "name")).collect(),
                album: t.get("album").and_then(|a| text(a, "title")),
                duration_ms: t.get("durationMs").and_then(Value::as_f64).and_then(|ms| {
                    if ms.is_finite() && ms > 0.0 {
                        Some(ms.round() as i64)
                    } else {
                        None
                    }
                }),
                isrc: None,
                track: Some(t.clone()),
                path: None,
            });
        }
    }
    Ok(Parsed { source_kind: "nuvo-json", label: text(doc, "title").unwrap_or_else(|| "Imported playlist".into()), liked: false, rows })
}

fn parse_nuvo_library(doc: &Value) -> Result<Vec<Parsed>, ParseError> {
    if doc.get("version").and_then(Value::as_i64) != Some(1) {
        return Err(unreadable("the Nuvo library version must be 1"));
    }
    let mut out = Vec::new();
    let liked = json!({"format": "nuvo-playlist", "version": 1, "title": "Liked songs", "tracks": doc.get("liked").cloned().unwrap_or_else(|| json!([]))});
    let liked = Parsed { liked: true, ..parse_nuvo(&liked)? };
    if !liked.rows.is_empty() {
        out.push(liked);
    }
    for playlist in doc.get("playlists").and_then(Value::as_array).into_iter().flatten() {
        out.push(parse_nuvo(playlist)?);
    }
    Ok(out)
}

fn is_video_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn youtube_track(id: &str, title: &str, artists: &[String], album: Option<&str>, duration_ms: Option<i64>) -> Value {
    let mut track = json!({
        "id": id,
        "title": title,
        "artists": artists.iter().map(|name| json!({"id": "", "name": name})).collect::<Vec<_>>(),
        "durationMs": duration_ms.unwrap_or(0),
    });
    if let Some(album) = album {
        track["album"] = json!({"id": "", "title": album});
    }
    track
}

pub fn youtube_id(url: &str) -> Option<String> {
    let rest = url.trim().strip_prefix("https://").or_else(|| url.trim().strip_prefix("http://"))?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.to_ascii_lowercase();
    let id = match host.as_str() {
        "youtu.be" => path.split(['?', '#', '/']).next()?,
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            if let Some(short) = path.strip_prefix("shorts/") {
                short.split(['?', '#', '/']).next()?
            } else {
                let query = path.strip_prefix("watch?")?;
                query.split(['&', '#']).find_map(|pair| pair.strip_prefix("v="))?
            }
        }
        _ => return None,
    };
    is_video_id(id).then(|| id.to_string())
}

fn artist_and_title(display: &str) -> (Vec<String>, String) {
    match display.split_once(" - ") {
        Some((artist, title)) if !artist.trim().is_empty() && !title.trim().is_empty() => (artist_list(artist), title.trim().to_string()),
        _ => (Vec::new(), display.trim().to_string()),
    }
}

pub fn parse_m3u(label: &str, text: &str) -> Result<Parsed, ParseError> {
    let mut rows = Vec::new();
    let mut info: Option<(Option<i64>, String)> = None;
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if rows.len() > MAX_ROWS {
            return Err(ParseError::TooManyRows);
        }
        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            let (seconds, display) = rest.split_once(',').unwrap_or((rest, ""));
            let seconds = seconds.split_whitespace().next().and_then(|s| s.parse::<f64>().ok()).filter(|s| *s > 0.0 && s.is_finite());
            info = Some((seconds.and_then(|s| {
                let ms = (s * 1000.0).round() as i64;
                (ms > 0).then_some(ms)
            }), display.trim().to_string()));
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        let (duration_ms, display) = info.take().unwrap_or((None, String::new()));
        let is_url = line.starts_with("http://") || line.starts_with("https://");
        let is_path = !is_url && (line.contains('/') || line.contains('\\'));
        let display = if display.is_empty() && is_path {
            let name = line.rsplit(['/', '\\']).next().unwrap_or(line);
            name.rsplit_once('.').map_or(name, |(stem, _)| stem).to_string()
        } else {
            display
        };
        let (artists, title) = artist_and_title(&display);
        if let Some(id) = is_url.then(|| youtube_id(line)).flatten() {
            let artist = artists.first().cloned().unwrap_or_default();
            let display_title = if title.is_empty() { id.clone() } else { title.clone() };
            let track = youtube_track(&id, &display_title, &[artist], None, duration_ms);
            rows.push(SourceRow { title: display_title, artists, duration_ms, track: Some(track), ..Default::default() });
        } else if !title.is_empty() && (is_url || is_path || duration_ms.is_some()) {
            let path = (is_path && line.starts_with('/')).then(|| line.to_string());
            rows.push(SourceRow { title, artists, duration_ms, path, ..Default::default() });
        }
    }
    Ok(Parsed { source_kind: "m3u", label: label.to_string(), liked: false, rows })
}

pub fn parse_txt(label: &str, text: &str) -> Result<Parsed, ParseError> {
    let mut rows = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        if rows.len() >= MAX_ROWS {
            return Err(ParseError::TooManyRows);
        }
        if let Some(id) = youtube_id(line) {
            let track = youtube_track(&id, &id, &[String::new()], None, None);
            rows.push(SourceRow { title: id, track: Some(track), ..Default::default() });
        } else if !line.starts_with("http://") && !line.starts_with("https://") {
            let (artists, title) = artist_and_title(line);
            rows.push(SourceRow { title, artists, ..Default::default() });
        }
    }
    Ok(Parsed { source_kind: "txt", label: label.to_string(), liked: false, rows })
}

fn xml_text(raw: &str) -> Result<String, ParseError> {
    if let Some(inner) = raw.trim().strip_prefix("<![CDATA[") {
        return inner.strip_suffix("]]>").map(|t| t.trim().to_string()).ok_or_else(|| unreadable("the XSPF file is broken"));
    }
    let mut out = String::new();
    let mut rest = raw.trim();
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let end = rest[at..].find(';').ok_or_else(|| unreadable("the XSPF file is broken"))?;
        let entity = &rest[at + 1..at + end];
        let code = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .map(|hex| u32::from_str_radix(hex, 16))
                .or_else(|| entity.strip_prefix('#').map(str::parse::<u32>))
                .and_then(Result::ok)
                .and_then(char::from_u32),
        };
        out.push(code.ok_or_else(|| unreadable("the XSPF file is broken"))?);
        rest = &rest[at + end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn xml_child(block: &str, tag: &str) -> Result<Option<String>, ParseError> {
    let open = format!("<{tag}>");
    let Some(start) = block.find(&open) else { return Ok(None) };
    let body = &block[start + open.len()..];
    let end = body.find(&format!("</{tag}>")).ok_or_else(|| unreadable("the XSPF file is broken"))?;
    Ok(Some(xml_text(&body[..end])?).filter(|t| !t.is_empty()))
}

fn file_path(url: &str) -> Option<String> {
    let encoded = url.strip_prefix("file://").filter(|p| p.starts_with('/'))?.as_bytes();
    let mut bytes = Vec::with_capacity(encoded.len());
    let mut i = 0;
    while i < encoded.len() {
        let hex = encoded.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok());
        match (encoded[i], hex) {
            (b'%', Some(byte)) => {
                bytes.push(byte);
                i += 3;
            }
            (byte, _) => {
                bytes.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8(bytes).ok()
}

pub fn parse_xspf(label: &str, text: &str) -> Result<Parsed, ParseError> {
    let (head, mut rest) = text.split_once("<trackList>").ok_or_else(|| unreadable("the XSPF file has no track list"))?;
    let label = xml_child(head, "title")?.unwrap_or_else(|| label.to_string());
    let mut rows = Vec::new();
    while let Some(start) = rest.find("<track>") {
        if rows.len() >= MAX_ROWS {
            return Err(ParseError::TooManyRows);
        }
        let block = &rest[start + 7..];
        let end = block.find("</track>").ok_or_else(|| unreadable("the XSPF file is broken"))?;
        let (track, after) = (&block[..end], &block[end + 8..]);
        rest = after;
        let Some(title) = xml_child(track, "title")? else { continue };
        let artists = xml_child(track, "creator")?.map(|a| artist_list(&a)).unwrap_or_default();
        let album = xml_child(track, "album")?;
        // the spec counts milliseconds; some converters write seconds
        let duration_ms = xml_child(track, "duration")?.and_then(|d| duration_ms(&d)).map(|ms| if ms < 10_000 { ms * 1000 } else { ms });
        let location = xml_child(track, "location")?;
        let row = SourceRow { title, artists, album, duration_ms, isrc: xml_child(track, "isrc")?, ..Default::default() };
        rows.push(match location.as_deref().and_then(youtube_id) {
            Some(id) => {
                let track = youtube_track(&id, &row.title, &row.artists[..row.artists.len().min(1)], row.album.as_deref(), row.duration_ms);
                SourceRow { track: Some(track), ..row }
            }
            None => SourceRow { path: location.as_deref().and_then(file_path), ..row },
        });
    }
    Ok(Parsed { source_kind: "xspf", label, liked: false, rows })
}
