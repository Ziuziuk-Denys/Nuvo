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
        "csv" => vec![parse_exportify(stem, &text)?],
        "m3u" | "m3u8" => vec![parse_m3u(stem, &text)?],
        "json" => parse_json(&text)?,
        _ => return Err(unreadable("pick a .csv, .json, .m3u or .m3u8 file")),
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

pub fn parse_exportify(label: &str, text: &str) -> Result<Parsed, ParseError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = csv_records(text)?.into_iter();
    let header: Vec<String> = records.next().ok_or_else(|| unreadable("the CSV is empty"))?.iter().map(|h| h.trim().to_lowercase()).collect();
    let column = |aliases: &[&str]| header.iter().position(|h| aliases.contains(&h.as_str()));
    let title = column(&["track name", "name", "title"]).ok_or_else(|| unreadable("the CSV has no Track Name column"))?;
    let artists = column(&["artist name(s)", "artist names", "artist", "artists"]);
    let album = column(&["album name", "album"]);
    let duration = column(&["duration (ms)", "duration_ms", "duration"]);
    let isrc = column(&["isrc"]);
    let cell = |record: &[String], index: Option<usize>| index.and_then(|i| record.get(i)).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let rows = records
        .filter_map(|record| {
            Some(SourceRow {
                title: cell(&record, Some(title))?,
                artists: cell(&record, artists).map(|a| artist_list(&a)).unwrap_or_default(),
                album: cell(&record, album),
                duration_ms: cell(&record, duration).and_then(|d| duration_ms(&d)),
                isrc: cell(&record, isrc),
                track: None,
                path: None,
            })
        })
        .collect();
    Ok(Parsed { source_kind: "spotify-csv", label: label.to_string(), liked: false, rows })
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

pub fn parse_json(text_in: &str) -> Result<Vec<Parsed>, ParseError> {
    let doc: Value = serde_json::from_str(text_in).map_err(|_| unreadable("the file is not valid JSON"))?;
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
    (id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then(|| id.to_string())
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
            let track = json!({"id": id, "title": display_title, "artists": [{"id": "", "name": artist}], "durationMs": duration_ms.unwrap_or(0)});
            rows.push(SourceRow { title: display_title, artists, duration_ms, track: Some(track), ..Default::default() });
        } else if !title.is_empty() && (is_url || is_path || duration_ms.is_some()) {
            let path = (is_path && line.starts_with('/')).then(|| line.to_string());
            rows.push(SourceRow { title, artists, duration_ms, path, ..Default::default() });
        }
    }
    Ok(Parsed { source_kind: "m3u", label: label.to_string(), liked: false, rows })
}
