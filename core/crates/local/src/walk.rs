//! Finds audio files under a music folder. Links are never followed (they can point outside the
//! folder or into a loop) and names starting with a dot are skipped.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav"];
/// Folder images, best first.
pub const FOLDER_ART: [&str; 4] = ["cover", "folder", "front", "album"];
const ART_EXTENSIONS: [&str; 3] = ["jpg", "jpeg", "png"];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WalkLimits {
    pub max_depth: usize,
    pub max_files: usize,
}

impl WalkLimits {
    pub const DEFAULT: WalkLimits = WalkLimits { max_depth: 32, max_files: 100_000 };
}

#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub path: PathBuf,
    pub size: u64,
    pub mtime_ms: i64,
    pub lrc: Option<PathBuf>,
    /// The file's folder holds a cover image.
    pub folder_art: bool,
}

#[derive(Debug, Default)]
pub struct Walk {
    pub files: Vec<Found>,
    pub skipped_links: usize,
    pub unreadable_dirs: usize,
    pub truncated: bool,
}

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

pub fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as i64)
}

/// Every audio file under `root`, sorted by path, until the limits.
pub fn walk(root: &Path, limits: WalkLimits) -> Walk {
    let mut out = Walk::default();
    // A root that is itself a link would be followed by read_dir.
    if fs::symlink_metadata(root).is_ok_and(|meta| meta.file_type().is_symlink()) {
        out.skipped_links += 1;
        return out;
    }
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    'dirs: while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            out.unreadable_dirs += 1;
            continue;
        };
        // lowercase name to real name, for the sidecar lookup
        let mut names: HashMap<String, String> = HashMap::new();
        let mut audio = Vec::new();
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            // shortcut: names that are not UTF-8 are skipped (SQLite stores text); count them if users report gaps
            let Some(name) = file_name.to_str() else { continue };
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                out.skipped_links += 1;
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if depth + 1 < limits.max_depth {
                    stack.push((path, depth + 1));
                }
            } else if kind.is_file() {
                names.insert(name.to_lowercase(), name.to_string());
                if is_audio(&path) {
                    audio.push(path);
                }
            }
        }
        let folder_art = names.keys().any(|name| art_rank(name).is_some());
        for path in audio {
            if out.files.len() >= limits.max_files {
                out.truncated = true;
                break 'dirs;
            }
            let Ok(meta) = fs::symlink_metadata(&path) else { continue };
            let lrc = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| names.get(&format!("{}.lrc", stem.to_lowercase())))
                .map(|real| dir.join(real));
            out.files.push(Found { size: meta.len(), mtime_ms: mtime_ms(&meta), lrc, folder_art, path });
        }
    }
    out.files.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// The folder's own cover image (`cover`, `folder`, `front`, `album` as jpg or png), never a link.
fn art_rank(lower_name: &str) -> Option<usize> {
    let (stem, ext) = lower_name.rsplit_once('.')?;
    if !ART_EXTENSIONS.contains(&ext) {
        return None;
    }
    FOLDER_ART.iter().position(|wanted| *wanted == stem)
}

pub fn folder_art(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(usize, PathBuf)> = None;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let name = entry.file_name();
        let Some(lower) = name.to_str().map(str::to_lowercase) else { continue };
        let Some(rank) = art_rank(&lower) else { continue };
        if best.as_ref().is_none_or(|(current, _)| rank < *current) {
            best = Some((rank, entry.path()));
        }
    }
    best.map(|(_, path)| path)
}
