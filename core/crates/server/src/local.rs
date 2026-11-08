//! Music folders: one loop scans them (only new and changed files are read with lofty), and
//! inotify watchers ask it to rescan a folder once changes settle.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, RwLock, Weak};
use std::time::Duration;

use notify::{Config as WatchConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use nuvo_contracts::{LocalRoot, LocalScanStatus};
use nuvo_local::tags::{local_id, meta_from_name, read_cover, read_meta, snapshot};
use nuvo_local::walk::{Found, WalkLimits, walk};
use nuvo_store::local::{self as store, FileRow, KnownFile};
use nuvo_store::now_ms;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::error::ApiError;
use crate::state::{AppState, Inner, Unlocked};

/// Files per database write: short lock holds keep playback requests fast during a scan.
const BATCH: usize = 200;
const WATCH_DEBOUNCE: Duration = Duration::from_secs(2);
/// A folder inotify cannot watch (limit reached) is rescanned this often instead.
const POLL_EVERY: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Msg {
    All,
    Root(i64),
    /// From a watcher: waits for the burst of changes to settle.
    Changed(i64),
}

#[derive(Default)]
pub struct LocalService {
    tx: OnceLock<mpsc::UnboundedSender<Msg>>,
    status: RwLock<LocalScanStatus>,
    watchers: Mutex<HashMap<i64, RecommendedWatcher>>,
}

impl LocalService {
    pub fn status(&self) -> LocalScanStatus {
        self.status.read().expect("scan status").clone()
    }

    fn update(&self, edit: impl FnOnce(&mut LocalScanStatus)) {
        edit(&mut self.status.write().expect("scan status"));
    }
}

/// Queues work for the loop and starts the loop on first use.
pub fn poke(state: &AppState, msg: Msg) {
    let tx = state.local.tx.get_or_init(|| {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(run(state.downgrade(), rx));
        tx
    });
    let _ = tx.send(msg);
}

async fn run(weak: Weak<Inner>, mut rx: mpsc::UnboundedReceiver<Msg>) {
    loop {
        let polling = AppState::upgrade(&weak).is_some_and(|s| s.local.status().polling);
        let first = if polling {
            match tokio::time::timeout(POLL_EVERY, rx.recv()).await {
                Ok(Some(msg)) => msg,
                Ok(None) => return,
                Err(_) => Msg::All,
            }
        } else {
            match rx.recv().await {
                Some(msg) => msg,
                None => return,
            }
        };
        let debounce = AppState::upgrade(&weak).and_then(|s| s.test.local_debounce).unwrap_or(WATCH_DEBOUNCE);
        let mut all = false;
        let mut roots = BTreeSet::new();
        let mut take = |msg: Msg| match msg {
            Msg::All => all = true,
            Msg::Root(id) | Msg::Changed(id) => {
                roots.insert(id);
            }
        };
        let settle = matches!(first, Msg::Changed(_));
        take(first);
        if settle {
            // quiet time, but never more than five times it in all: a steady storm still gets scanned
            let give_up = tokio::time::Instant::now() + debounce * 5;
            while let Ok(Some(msg)) = tokio::time::timeout(debounce.min(give_up.saturating_duration_since(tokio::time::Instant::now())), rx.recv()).await {
                take(msg);
            }
        }
        while let Ok(msg) = rx.try_recv() {
            take(msg);
        }
        let Some(state) = AppState::upgrade(&weak) else { return };
        let Ok(data) = state.data() else { continue };
        if let Err(err) = scan(&state, &data, all, &roots).await {
            tracing::warn!(?err, "local scan failed");
        }
    }
}

async fn scan(state: &AppState, data: &Unlocked, all: bool, wanted: &BTreeSet<i64>) -> Result<(), ApiError> {
    let roots = data.db.call(store::roots).await?;
    // Watch first, so a change during the scan queues another scan instead of being missed.
    sync_watchers(state, &roots);
    for root in roots.iter().filter(|r| all || wanted.contains(&r.id)) {
        scan_root(state, data, root).await?;
    }
    sync_watchers(state, &data.db.call(store::roots).await?);
    Ok(())
}

async fn scan_root(state: &AppState, data: &Unlocked, root: &LocalRoot) -> Result<(), ApiError> {
    let root_id = root.id;
    let path = PathBuf::from(&root.path);
    if !tokio::fs::metadata(&path).await.is_ok_and(|m| m.is_dir()) {
        // An unplugged drive: every row stays, so likes and playlists still know the files.
        data.db.call(move |c| store::mark_root(c, root_id, "missing", None)).await?;
        return Ok(());
    }
    state.local.update(|s| {
        *s = LocalScanStatus { scanning: true, root_id: Some(root_id), watching: s.watching, polling: s.polling, last_scan_at: s.last_scan_at, ..Default::default() };
    });
    let result = scan_files(state, data, root_id, path).await;
    let now = now_ms();
    state.local.update(|s| {
        s.scanning = false;
        s.root_id = None;
        s.last_scan_at = Some(now);
    });
    data.db.call(move |c| store::mark_root(c, root_id, "ok", Some(now))).await?;
    result
}

async fn scan_files(state: &AppState, data: &Unlocked, root_id: i64, path: PathBuf) -> Result<(), ApiError> {
    let blocking = |e: tokio::task::JoinError| ApiError::Internal(e.to_string());
    let walked = tokio::task::spawn_blocking(move || walk(&path, WalkLimits::DEFAULT)).await.map_err(blocking)?;
    let known = data.db.call(move |c| store::known_files(c, root_id)).await?;
    let plan = plan(&known, &walked.files);
    state.local.update(|s| {
        s.total = plan.read.len() as u64;
        s.skipped_links = walked.skipped_links as u64;
        s.truncated = walked.truncated;
        s.removed = plan.removed.len() as u64;
    });
    for chunk in plan.read.chunks(BATCH) {
        let chunk = chunk.to_vec();
        let read = tokio::task::spawn_blocking(move || chunk.iter().map(|p| file_and_snapshot(&p.found, p.track_id.clone())).collect::<Vec<_>>())
            .await
            .map_err(blocking)?;
        let added = read.iter().filter(|(_, _, new)| *new).count() as u64;
        let unreadable = read.iter().filter(|(row, _, _)| row.unsupported.as_deref() == Some("unreadable")).count() as u64;
        let count = read.len() as u64;
        let rows: Vec<(FileRow, Value)> = read.into_iter().map(|(row, snapshot, _)| (row, snapshot)).collect();
        data.db.call(move |c| store::apply(c, root_id, &rows, &[], now_ms())).await?;
        state.local.update(|s| {
            s.read += count;
            s.added += added;
            s.updated += count - added;
            s.unreadable += unreadable;
        });
    }
    let removed = plan.removed;
    if !removed.is_empty() {
        data.db.call(move |c| store::apply(c, root_id, &[], &removed, now_ms())).await?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pending {
    pub found: Found,
    /// The id the file keeps: its old one when it changed or moved, `None` for a new file.
    pub track_id: Option<String>,
}

#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    pub read: Vec<Pending>,
    pub unchanged: usize,
    pub removed: Vec<String>,
}

/// Read new and changed files, drop vanished ones. A vanished file and a new one with the same
/// size and modification time are one file that moved (`mv` keeps the time): it keeps its id.
pub fn plan(known: &[KnownFile], found: &[Found]) -> Plan {
    let by_path: HashMap<&str, &KnownFile> = known.iter().map(|k| (k.path.as_str(), k)).collect();
    let present: HashSet<String> = found.iter().map(|f| f.path.to_string_lossy().into_owned()).collect();
    let mut moved: HashMap<(i64, i64), Vec<String>> = HashMap::new();
    let mut out = Plan::default();
    for gone in known.iter().filter(|k| !present.contains(&k.path)) {
        moved.entry((gone.size_bytes, gone.mtime_ms)).or_default().push(gone.track_id.clone());
        out.removed.push(gone.path.clone());
    }
    for f in found {
        let path = f.path.to_string_lossy();
        match by_path.get(path.as_ref()) {
            Some(k) if k.size_bytes == f.size as i64 && k.mtime_ms == f.mtime_ms && k.has_lrc == f.lrc.is_some() && k.folder_art == Some(f.folder_art) => out.unchanged += 1,
            Some(k) => out.read.push(Pending { found: f.clone(), track_id: Some(k.track_id.clone()) }),
            None => {
                let reuse = moved.get_mut(&(f.size as i64, f.mtime_ms)).and_then(Vec::pop);
                out.read.push(Pending { found: f.clone(), track_id: reuse });
            }
        }
    }
    out
}

/// A file lofty cannot read is kept by its name and marked unreadable, so the user sees why.
pub fn file_and_snapshot(found: &Found, track_id: Option<String>) -> (FileRow, Value, bool) {
    let path = found.path.to_string_lossy().into_owned();
    let is_new = track_id.is_none();
    let id = track_id.unwrap_or_else(|| local_id(&path));
    let meta = read_meta(&found.path).unwrap_or_else(|_| meta_from_name(&found.path));
    let has_cover = read_cover(&found.path).is_ok_and(|cover| cover.is_some());
    let row = FileRow {
        path,
        track_id: id.clone(),
        size_bytes: found.size as i64,
        mtime_ms: found.mtime_ms,
        mime: meta.mime.into(),
        codec: meta.codec.into(),
        bitrate_kbps: meta.bitrate_kbps.map(i64::from),
        sample_rate: meta.sample_rate.map(i64::from),
        bit_depth: meta.bit_depth.map(i64::from),
        lossless: meta.lossless,
        unsupported: meta.unsupported.map(String::from),
        lrc_path: found.lrc.as_ref().map(|p| p.to_string_lossy().into_owned()),
        folder_art: found.folder_art,
    };
    (row, snapshot(&id, &meta, has_cover), is_new)
}

fn sync_watchers(state: &AppState, roots: &[LocalRoot]) {
    let Some(tx) = state.local.tx.get().cloned() else { return };
    let reachable: Vec<&LocalRoot> = roots.iter().filter(|r| r.status == "ok").collect();
    let mut watchers = state.local.watchers.lock().expect("watchers");
    watchers.retain(|id, _| reachable.iter().any(|r| r.id == *id));
    for root in &reachable {
        if watchers.contains_key(&root.id) {
            continue;
        }
        match watch(&root.path, root.id, tx.clone()) {
            Ok(watcher) => {
                watchers.insert(root.id, watcher);
            }
            Err(err) => tracing::warn!(%err, "cannot watch a music folder; it is rescanned every 15 minutes"),
        }
    }
    let watching = watchers.len() as u64;
    let polling = watchers.len() < reachable.len();
    drop(watchers);
    state.local.update(|s| {
        s.watching = watching;
        s.polling = polling;
    });
}

fn watch(path: &str, root_id: i64, tx: mpsc::UnboundedSender<Msg>) -> notify::Result<RecommendedWatcher> {
    let mut watcher = RecommendedWatcher::new(
        move |event: notify::Result<Event>| {
            // reads (ours included) are not changes
            if event.is_ok_and(|e| !matches!(e.kind, EventKind::Access(_))) {
                let _ = tx.send(Msg::Changed(root_id));
            }
        },
        WatchConfig::default().with_follow_symlinks(false),
    )?;
    watcher.watch(Path::new(path), RecursiveMode::Recursive)?;
    Ok(watcher)
}
