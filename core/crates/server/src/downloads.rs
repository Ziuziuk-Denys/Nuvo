use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{OnceLock, Weak};
use std::time::Duration;

use nuvo_local::save::{SaveTags, extension_for, file_name, input_format, write_tags};
use nuvo_store::downloads::{self, Ready};
use nuvo_store::{local, new_id};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::routes::local::open_inside;
use crate::state::{AppState, Inner, Unlocked};

const COPY_CHUNK: u64 = 1024 * 1024;
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct Worker {
    tx: OnceLock<mpsc::UnboundedSender<()>>,
}

pub fn poke(state: &AppState) {
    let tx = state.downloads.tx.get_or_init(|| {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(run(state.downgrade(), rx));
        tx
    });
    let _ = tx.send(());
}

async fn run(weak: Weak<Inner>, mut rx: mpsc::UnboundedReceiver<()>) {
    let mut stuck = std::collections::HashSet::new();
    while rx.recv().await.is_some() {
        while rx.try_recv().is_ok() {}
        let Some(state) = AppState::upgrade(&weak) else { return };
        let Ok(data) = state.data() else { continue };
        while let Ok(Some(item)) = data.db.call(downloads::next).await {
            let key = (item.download_id.clone(), item.position);
            if stuck.contains(&key) {
                break;
            }
            let result = save_item(&state, &data, &item).await;
            if let Err(reason) = &result {
                tracing::warn!(%reason, "a track could not be saved");
            }
            let closed = match record(&state, &data, &item, result).await {
                Ok(closed) => closed,
                Err(()) => {
                    stuck.insert(key);
                    tokio::time::sleep(FINISH_BACKOFF).await;
                    break;
                }
            };
            if closed && let Err(reason) = write_playlist(&data, &item.download_id).await {
                tracing::warn!(%reason, "the playlist file could not be written");
            }
        }
    }
}

const FINISH_BACKOFF: Duration = Duration::from_secs(5);
const FINISH_TRIES: u64 = 3;

async fn record(state: &AppState, data: &Unlocked, item: &Ready, result: Result<String, String>) -> Result<bool, ()> {
    let mut result = result;
    for attempt in 1..=FINISH_TRIES {
        let (id, position, outcome) = (item.download_id.clone(), item.position, result.clone());
        let injected = state.test.finish_failures.try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1)).is_ok();
        let written = if injected { None } else { data.db.call(move |c| downloads::finish(c, &id, position, outcome)).await.ok() };
        if let Some(closed) = written {
            return Ok(closed);
        }
        if let Ok(name) = &result {
            tracing::warn!("a saved track could not be recorded; its file is deleted");
            let _ = tokio::fs::remove_file(Path::new(&item.dir).join(name)).await;
            result = Err("the result could not be recorded".into());
        }
        tokio::time::sleep(Duration::from_millis(100 * attempt)).await;
    }
    Err(())
}

// Only empty names a still-queued track would be saved under are removed; other empty files are the user's
pub async fn clean_stale(data: &Unlocked) {
    let Ok(dirs) = data.db.call(downloads::dirs).await else { return };
    let Ok(queued) = data.db.call(downloads::queued).await else { return };
    let mut reserved: Vec<(PathBuf, String)> = Vec::new();
    for (dir, snapshot) in queued {
        let stem = file_name(&artists_of(&snapshot), snapshot["title"].as_str().unwrap_or("Track"), "x");
        reserved.push((PathBuf::from(dir), stem.trim_end_matches(".x").to_string()));
    }
    let mut removed = 0;
    for dir in dirs {
        let Ok(mut entries) = tokio::fs::read_dir(&dir).await else { continue };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(meta) = entry.metadata().await else { continue };
            let stale_part = name.starts_with(".nuvo-") && name.ends_with(".part");
            let empty_reserved = meta.is_file() && meta.len() == 0 && reserved.iter().any(|(d, stem)| d.as_path() == Path::new(&dir) && names_stem(&name, stem));
            if (meta.is_file() && stale_part || empty_reserved) && tokio::fs::remove_file(entry.path()).await.is_ok() {
                removed += 1;
            }
        }
    }
    tracing::info!(removed, "removed leftovers of interrupted saves");
}

fn names_stem(name: &str, stem: &str) -> bool {
    let Some((base, _)) = name.rsplit_once('.') else { return false };
    base == stem || base.strip_prefix(stem).and_then(|rest| rest.strip_prefix(" (")).and_then(|rest| rest.strip_suffix(')')).is_some_and(|n| n.parse::<u32>().is_ok())
}

fn artists_of(snapshot: &Value) -> String {
    snapshot["artists"].as_array().into_iter().flatten().filter_map(|a| a["name"].as_str()).collect::<Vec<_>>().join(", ")
}

async fn create_part(dir: &Path) -> Result<(PathBuf, tokio::fs::File), String> {
    let part = dir.join(format!(".nuvo-{}.part", new_id()));
    let file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&part).await.map_err(|e| format!("cannot write in this folder: {}", e.kind()))?;
    Ok((part, file))
}

async fn save_item(state: &AppState, data: &Unlocked, item: &Ready) -> Result<String, String> {
    let dir = PathBuf::from(&item.dir);
    let title = item.snapshot["title"].as_str().unwrap_or("Track").to_string();
    let artists = artists_of(&item.snapshot);
    // the folder was checked when the job started; it must still be that very folder
    if tokio::fs::canonicalize(&dir).await.ok().as_deref() != Some(dir.as_path()) {
        return Err("the folder moved or is gone".into());
    }
    let (part, mut out) = create_part(&dir).await?;
    let copied = copy_audio(data, item, &dir, &mut out).await;
    let synced = out.sync_all().await.map_err(|e| e.to_string());
    let ext = match copied.and_then(|ext| synced.map(|_| ext)) {
        Ok(ext) => ext,
        Err(reason) => {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(reason);
        }
    };
    let ffmpeg = state.env.find("ffmpeg");
    let target = match (item.format.as_str(), ext.as_str(), ffmpeg) {
        ("mp3", "mp3", _) => None,
        ("mp3", _, Some(tool)) => Some((tool, "mp3")),
        // a remux, not a re-encode: WebM cannot carry tags, Ogg Opus can
        (_, "webm", Some(tool)) => Some((tool, "opus")),
        _ => None,
    };
    let (part, ext) = match target {
        Some((tool, to)) => match transcode(&tool, &part, &ext, to, &dir).await {
            Ok(next) => (next, to.to_string()),
            Err(reason) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(reason);
            }
        },
        None => (part, ext),
    };
    if !item.local && ext != "webm" {
        let cover = cover_for(state, &item.snapshot).await;
        let album = item.snapshot.pointer("/album/title").and_then(Value::as_str).map(String::from);
        let (path, title, artists) = (part.clone(), title.clone(), artists.clone());
        let tagged = tokio::task::spawn_blocking(move || {
            let cover = cover.as_ref().map(|(bytes, mime)| (bytes.as_slice(), mime.as_str()));
            write_tags(&path, &SaveTags { title: &title, artists: &artists, album: album.as_deref(), cover })
        })
        .await;
        if !matches!(tagged, Ok(Ok(()))) {
            tracing::warn!("saved without tags");
        }
    }
    publish(&part, &dir, &file_name(&artists, &title, &ext))
}

async fn copy_audio(data: &Unlocked, item: &Ready, dir: &Path, out: &mut tokio::fs::File) -> Result<String, String> {
    if item.local {
        let lookup = item.track_id.clone();
        let file = data.db.call(move |c| local::file_for(c, &lookup)).await.map_err(|e| e.to_string())?.ok_or("the local file is gone")?;
        let mut opened = open_inside(&file.row.path, &file.root_path).await.map_err(|_| "the local file is gone".to_string())?;
        ensure_room(dir, opened.size)?;
        tokio::io::copy(&mut opened.file, out).await.map_err(write_error)?;
        // the extension names the saved file: letters and digits only
        let ext = Path::new(&file.row.path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        return Ok(if (1..=5).contains(&ext.len()) && ext.bytes().all(|b| b.is_ascii_alphanumeric()) { ext } else { "bin".into() });
    }
    let mime = item.mime.clone().ok_or("the audio is not cached")?;
    let size = data.cache.size(&item.track_id).await.map_err(|e| e.to_string())?.ok_or("the cached audio is gone")?;
    ensure_room(dir, size)?;
    let mut start = 0;
    while start < size {
        let end = (start + COPY_CHUNK).min(size) - 1;
        let bytes = data.cache.read_range(&item.track_id, start, end).await.map_err(|e| e.to_string())?;
        out.write_all(&bytes).await.map_err(write_error)?;
        start = end + 1;
    }
    Ok(extension_for(&mime, item.codec.as_deref()).to_string())
}

const ROOM_MARGIN: u64 = 16 * 1024 * 1024;

fn has_room(free: u64, size: u64) -> bool {
    free >= size.saturating_mul(2).saturating_add(ROOM_MARGIN)
}

#[cfg(unix)]
fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: `path` is a valid NUL-terminated string and `stats` is a plain struct statvfs fills in
    let stats = unsafe {
        let mut stats: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(path.as_ptr(), &mut stats) != 0 {
            return None;
        }
        stats
    };
    Some((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
}

#[cfg(windows)]
fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    // SAFETY: `wide` is NUL-terminated and `available` outlives the call; the other outputs are optional
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(available)
}

fn ensure_room(dir: &Path, size: u64) -> Result<(), String> {
    match free_bytes(dir) {
        Some(free) if !has_room(free, size) => Err("not enough free space in the folder".into()),
        _ => Ok(()),
    }
}

#[cfg(unix)]
const DISK_FULL: i32 = libc::ENOSPC;
#[cfg(windows)]
const DISK_FULL: i32 = 112; // ERROR_DISK_FULL

fn write_error(err: std::io::Error) -> String {
    if err.raw_os_error() == Some(DISK_FULL) { "not enough free space in the folder".into() } else { err.to_string() }
}

async fn transcode(tool: &Path, input: &Path, from: &str, to: &str, dir: &Path) -> Result<PathBuf, String> {
    let output = dir.join(format!(".nuvo-{}.part", new_id()));
    let codec: &[&str] = if to == "mp3" { &["-c:a", "libmp3lame", "-q:a", "0", "-f", "mp3"] } else { &["-c:a", "copy", "-f", "ogg"] };
    let mut command = Command::new(tool);
    command.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file"]);
    if let Some(format) = input_format(from) {
        command.args(["-f", format]);
    }
    command.arg("-i");
    command.arg(format!("file:{}", input.display()));
    command.arg("-vn").args(codec).arg(format!("file:{}", output.display()));
    let result = nuvo_fetch::process::run(command, FFMPEG_TIMEOUT, 0, 64 * 1024).await;
    let _ = tokio::fs::remove_file(input).await;
    match result {
        Ok(out) if out.status.success() => Ok(output),
        _ => {
            let _ = tokio::fs::remove_file(&output).await;
            Err("ffmpeg could not convert the audio".into())
        }
    }
}

async fn cover_for(state: &AppState, snapshot: &Value) -> Option<(Vec<u8>, String)> {
    let url = snapshot.pointer("/cover/url").and_then(Value::as_str).filter(|u| u.starts_with("https://"))?;
    let request = nuvo_covers::prepare(Some(url), None, Some("1024")).ok()?;
    let cover = state.covers.get(&request, state.cover_disk()).await.ok()?;
    matches!(cover.content_type.as_str(), "image/jpeg" | "image/png").then(|| (cover.bytes, cover.content_type))
}

// Reserving with create_new never overwrites and works on FAT drives that refuse hard links
fn publish(part: &Path, dir: &Path, name: &str) -> Result<String, String> {
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    for n in 1..=99 {
        let candidate = if n == 1 { name.to_string() } else { format!("{stem} ({n}).{ext}") };
        let target = dir.join(&candidate);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(_) => {
                return std::fs::rename(part, &target).map(|_| candidate).map_err(|e| {
                    let _ = std::fs::remove_file(&target);
                    let _ = std::fs::remove_file(part);
                    e.to_string()
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                let _ = std::fs::remove_file(part);
                return Err(e.to_string());
            }
        }
    }
    let _ = std::fs::remove_file(part);
    Err("too many files with this name".into())
}

async fn write_playlist(data: &Unlocked, id: &str) -> Result<(), String> {
    let id = id.to_string();
    let (label, dir, wanted, files) = data.db.call(move |c| downloads::saved_files(c, &id)).await.map_err(|e| e.to_string())?;
    if !wanted || files.is_empty() {
        return Ok(());
    }
    let dir = PathBuf::from(dir);
    let (part, mut out) = create_part(&dir).await?;
    let body = std::iter::once("#EXTM3U".to_string()).chain(files).collect::<Vec<_>>().join("\n") + "\n";
    out.write_all(body.as_bytes()).await.map_err(|e| e.to_string())?;
    out.sync_all().await.map_err(|e| e.to_string())?;
    publish(&part, &dir, &file_name("", &label, "m3u8")).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_needs_the_copy_twice_and_a_margin() {
        assert!(!has_room(ROOM_MARGIN, 1));
        assert!(!has_room(2 * 100 + ROOM_MARGIN - 1, 100));
        assert!(has_room(2 * 100 + ROOM_MARGIN, 100));
        assert!(!has_room(u64::MAX - 1, u64::MAX), "no overflow");
    }

    #[test]
    fn the_free_space_of_a_real_folder_is_known() {
        let dir = tempfile::tempdir().unwrap();
        assert!(free_bytes(dir.path()).is_some_and(|free| free > 0));
        assert_eq!(free_bytes(&dir.path().join("missing")), None);
    }
}
