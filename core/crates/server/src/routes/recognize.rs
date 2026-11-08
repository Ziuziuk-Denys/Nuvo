//! `POST /v1/recognize` streams one recognition job; history and tool status routes.
//! `POST /v1/fs/recognize/file` is Electron main's: pages name a granted file, never a path.

use std::collections::HashMap;
use std::convert::Infallible;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures::Stream;
use nuvo_contracts::iso_from_ms;
use nuvo_fetch::ffmpeg::{self, Input};
use nuvo_fetch::tools::{self, ToolEnv, Tools};
use nuvo_fetch::ytdlp;
use nuvo_fetch::{FetchError, Remote, ensure_public, follow_public, parse_link};
use nuvo_recognize::plan::{self, ListenError, Media, Outcome, STEREO_SAMPLES_PER_MS, Stage, WINDOW_MS, WindowSource};
use nuvo_recognize::{InputInfo, InputKind, RecognizedTrack, Via};
use nuvo_store::{new_id, now_ms, recognitions};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::task::JoinHandle;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::links::Inspected;
use crate::state::{AppState, Unlocked};

/// Media up to this long is decoded once; longer media window by window.
const DECODE_ONCE_MS: u64 = 60_000;
const HISTORY_DEFAULT: i64 = 50;
/// Long enough for "try another part" after the first run.
const GRANT_TTL: Duration = Duration::from_secs(600);
/// Files arrive one at a time; this only bounds a burst.
const MAX_GRANTS: usize = 32;

/// Files Electron main vouched for, by opaque id.
#[derive(Default)]
pub struct FileGrants(Mutex<HashMap<String, (Instant, PathBuf)>>);

impl FileGrants {
    fn put(&self, path: PathBuf, now: Instant) -> String {
        let mut grants = self.0.lock().expect("file grants lock");
        grants.retain(|_, (at, _)| now.saturating_duration_since(*at) < GRANT_TTL);
        if grants.len() >= MAX_GRANTS
            && let Some(oldest) = grants.iter().min_by_key(|(_, (at, _))| *at).map(|(id, _)| id.clone())
        {
            grants.remove(&oldest);
        }
        let id = new_id();
        grants.insert(id.clone(), (now, path));
        id
    }

    fn get(&self, id: &str, now: Instant) -> Option<PathBuf> {
        let grants = self.0.lock().expect("file grants lock");
        grants.get(id).filter(|(at, _)| now.saturating_duration_since(*at) < GRANT_TTL).map(|(_, path)| path.clone())
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/recognize", post(recognize))
        .route("/v1/fs/recognize/file", post(grant_file))
        .route("/v1/recognize/history", get(history))
        .route("/v1/recognize/history/{id}", delete(remove))
        .route("/v1/recognize/tools", get(tool_versions))
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Body {
    url: Option<String>,
    /// An id from `POST /v1/fs/recognize/file`.
    file: Option<String>,
    #[serde(default)]
    system: bool,
    #[serde(default)]
    microphone: bool,
    /// 0 for the first run, 1 for "try another part".
    #[serde(default)]
    part: u8,
}

enum Job {
    Link(String),
    /// Unknown or expired grants hold no path.
    File(Option<PathBuf>),
    System,
    Microphone,
}

/// Aborts the job when the response stream is dropped, which happens when the client closes it.
/// Dropping the job drops its child processes, which are `kill_on_drop`.
struct AbortOnDrop(JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantBody {
    path: String,
}

async fn grant_file(State(state): State<AppState>, JsonBody(body): JsonBody<GrantBody>) -> Result<Json<Value>, ApiError> {
    if !FsPath::new(&body.path).is_absolute() {
        return Err(ApiError::Invalid("the path must be absolute".into()));
    }
    Ok(Json(json!({"id": state.files.put(PathBuf::from(body.path), Instant::now())})))
}

async fn recognize(State(state): State<AppState>, JsonBody(body): JsonBody<Body>) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let data = state.data()?;
    let job = match (body.url, body.file, body.system, body.microphone) {
        (Some(url), None, false, false) => Job::Link(url),
        (None, Some(id), false, false) => Job::File(state.files.get(&id, Instant::now())),
        (None, None, true, false) => Job::System,
        (None, None, false, true) => Job::Microphone,
        _ => return Err(ApiError::Invalid("send exactly one of url, file, system: true or microphone: true".into())),
    };
    if body.part > 1 {
        return Err(ApiError::Invalid("part is 0 or 1".into()));
    }
    let (tx, rx) = mpsc::unbounded_channel();
    let handle = tokio::spawn(run(state, data, job, body.part, tx));
    let stream = futures::stream::unfold((rx, AbortOnDrop(handle)), |(mut rx, guard)| async move {
        rx.recv().await.map(|event| (Ok(event), (rx, guard)))
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

fn emit(tx: &UnboundedSender<Event>, value: Value) {
    let _ = tx.send(Event::default().data(value.to_string()));
}

/// Everything the plan needs, decided before listening starts.
struct Prepared {
    source: Source,
    main_ms: Option<u64>,
    clean_ms: Option<u64>,
    mix: Via,
    input: InputInfo,
    /// A named TikTok sound, offered when nothing matches.
    hint: Option<(String, String)>,
}

async fn run(state: AppState, data: Unlocked, job: Job, part: u8, tx: UnboundedSender<Event>) {
    let prepared = match prepare(&state, job, &tx).await {
        Ok(prepared) => prepared,
        Err(err) => {
            tracing::info!(code = err.code(), "recognize: could not get audio");
            return emit(&tx, json!({"type": "error", "code": err.code()}));
        }
    };
    let Prepared { mut source, main_ms, clean_ms, mix, input, hint } = prepared;
    let candidates = plan::candidates(main_ms, clean_ms, mix, part);
    let report = |stage: Stage| match stage {
        Stage::Listening { attempt, of, via, envelope } => {
            emit(&tx, json!({"type": "stage", "name": "listening", "attempt": attempt, "of": of, "via": via, "envelope": envelope}))
        }
        Stage::Waiting { seconds } => emit(&tx, json!({"type": "stage", "name": "waiting", "seconds": seconds})),
    };
    match plan::listen(&state.shazam, &mut source, &candidates, report).await {
        Ok(Outcome::Found { song, via }) => {
            let track = RecognizedTrack { song: *song, via, input };
            let value = serde_json::to_value(&track).expect("tracks serialize");
            let (id, stored) = (new_id(), value.clone());
            let (row_id, kind, label) = (id.clone(), track.input.kind.as_str(), track.input.label.clone());
            if let Err(err) = data.db.call(move |c| recognitions::insert(c, &row_id, now_ms(), kind, &label, &stored)).await {
                tracing::warn!(%err, "recognize: result not saved to history");
            }
            emit(&tx, json!({"type": "result", "id": id, "track": value}));
        }
        Ok(Outcome::NotFound) => {
            if let Some((title, artist)) = hint {
                emit(&tx, json!({"type": "hint", "title": title, "artist": artist}));
            }
            emit(&tx, json!({"type": "notFound", "more": plan::has_more(main_ms, part)}));
        }
        Err(err) => {
            let code = match &err {
                ListenError::Busy => "busy",
                ListenError::Shazam(_) => "network",
                ListenError::Audio(fetch) => fetch.code(),
            };
            tracing::info!(code, "recognize: listening failed");
            emit(&tx, json!({"type": "error", "code": code}));
        }
    }
}

async fn prepare(state: &AppState, job: Job, tx: &UnboundedSender<Event>) -> Result<Prepared, FetchError> {
    let tools = found_tools(state);
    let ffmpeg = tools.require_ffmpeg()?.to_path_buf();
    let (proxy, hook) = (state.proxy_url(), state.proxy_hook());
    match job {
        Job::Link(url) => {
            emit(tx, json!({"type": "stage", "name": "resolving"}));
            let link = parse_link(&url)?;
            let mut hint = None;
            // A link the renderer just inspected is not fetched again.
            let (seen_post, seen_media) = match state.links.get(&link.url, Instant::now()) {
                Some(Inspected::TikTok(post)) => (Some(post), None),
                Some(Inspected::Media(resolved, _)) => (None, Some(resolved)),
                None => (None, None),
            };
            if link.tiktok {
                let post = match seen_post {
                    Some(post) => Ok(post),
                    None => state.tiktok.post(&link.url).await,
                };
                match post {
                    Ok(post) => {
                        let sound = post.sound.filter(|s| !s.original);
                        hint = sound.as_ref().map(|s| (s.title.clone(), s.author.clone()));
                        // Every media URL is checked, redirects included, before ffmpeg reads it.
                        let video = match post.video {
                            Some(remote) => Some(follow_public(&remote, Some(&hook)).await?),
                            None => None,
                        };
                        let sound = match sound {
                            Some(mut sound) => {
                                sound.remote = follow_public(&sound.remote, Some(&hook)).await?;
                                Some(sound)
                            }
                            None => None,
                        };
                        emit(tx, json!({"type": "stage", "name": "fetching", "detail": post.title}));
                        let main_ms = video.as_ref().map(|_| known_or_window(post.duration_ms));
                        return Ok(Prepared {
                            main_ms,
                            clean_ms: sound.as_ref().map(|s| known_or_window(s.duration_ms)),
                            source: Source {
                                ffmpeg,
                                proxy,
                                main: video.map(|remote| Origin::new(Owned::Remote(remote), main_ms.unwrap_or(0))),
                                clean: sound.map(|s| Origin::new(Owned::Remote(s.remote), known_or_window(s.duration_ms))),
                            },
                            mix: Via::Mix,
                            input: InputInfo { kind: InputKind::Link, label: post.title },
                            hint,
                        });
                    }
                    // A wall or a network hiccup on our side: yt-dlp may still get through.
                    Err(FetchError::Blocked | FetchError::Network(_)) => {}
                    Err(other) => return Err(other),
                }
            } else if seen_media.is_none() {
                ensure_public(&link.url).await?;
            }
            let resolved = match seen_media {
                Some(resolved) => resolved,
                None => ytdlp::resolve(tools.require_yt_dlp()?, &link.url, proxy.as_deref()).await?,
            };
            let remote = follow_public(&resolved.remote, Some(&hook)).await?;
            // The history keeps no credentials or query string from the link.
            let label = resolved.title.clone().unwrap_or_else(|| nuvo_fetch::link::bare_url(&link.url));
            emit(tx, json!({"type": "stage", "name": "fetching", "detail": label}));
            // Unknown length (live streams): listen from the start.
            let main_ms = resolved.duration_ms.unwrap_or(WINDOW_MS);
            Ok(Prepared {
                source: Source { ffmpeg, proxy, main: Some(Origin::new(Owned::Remote(remote), main_ms)), clean: None },
                main_ms: Some(main_ms),
                clean_ms: None,
                mix: Via::Mix,
                input: InputInfo { kind: InputKind::Link, label },
                hint,
            })
        }
        Job::File(path) => {
            let path = path.ok_or(FetchError::Unavailable)?;
            let metadata = tokio::fs::metadata(&path).await.map_err(|_| FetchError::Unavailable)?;
            if !metadata.is_file() {
                return Err(FetchError::Unsupported);
            }
            let label = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            emit(tx, json!({"type": "stage", "name": "fetching", "detail": label}));
            let main_ms = ffmpeg::probe(&ffmpeg, &path).await?.unwrap_or(WINDOW_MS);
            Ok(Prepared {
                source: Source { ffmpeg, proxy, main: Some(Origin::new(Owned::File(path), main_ms)), clean: None },
                main_ms: Some(main_ms),
                clean_ms: None,
                mix: Via::Mix,
                input: InputInfo { kind: InputKind::File, label },
                hint: None,
            })
        }
        Job::System | Job::Microphone => {
            emit(tx, json!({"type": "stage", "name": "fetching"}));
            let microphone = matches!(job, Job::Microphone);
            let (input, main_ms) = match state.test.system_clip.clone() {
                Some(clip) => {
                    let ms = ffmpeg::probe(&ffmpeg, &clip).await?.unwrap_or(WINDOW_MS);
                    (Owned::File(clip), ms)
                }
                None if microphone => (Owned::Microphone, ffmpeg::MONITOR_MS),
                None => (Owned::Monitor, ffmpeg::MONITOR_MS),
            };
            Ok(Prepared {
                source: Source { ffmpeg, proxy, main: Some(Origin::new(input, main_ms)), clean: None },
                main_ms: Some(main_ms),
                clean_ms: None,
                mix: Via::System,
                input: if microphone {
                    InputInfo { kind: InputKind::Microphone, label: "Microphone".into() }
                } else {
                    InputInfo { kind: InputKind::System, label: "System audio".into() }
                },
                hint: None,
            })
        }
    }
}

/// TikTok reports 0 when it does not know the length.
fn known_or_window(duration_ms: u64) -> u64 {
    if duration_ms == 0 { WINDOW_MS } else { duration_ms }
}

enum Owned {
    File(PathBuf),
    Remote(Remote),
    Monitor,
    Microphone,
}

impl Owned {
    fn input(&self) -> Input<'_> {
        match self {
            Self::File(path) => Input::File(path),
            Self::Remote(remote) => Input::Remote(remote),
            Self::Monitor => Input::Monitor,
            Self::Microphone => Input::Microphone,
        }
    }
}

struct Origin {
    input: Owned,
    duration_ms: u64,
    whole: Option<Vec<i16>>,
}

impl Origin {
    fn new(input: Owned, duration_ms: u64) -> Self {
        Self { input, duration_ms, whole: None }
    }
}

struct Source {
    ffmpeg: PathBuf,
    proxy: Option<String>,
    main: Option<Origin>,
    clean: Option<Origin>,
}

impl WindowSource for Source {
    type Error = FetchError;

    async fn window(&mut self, media: Media, start_ms: u64, len_ms: u64) -> Result<Vec<i16>, FetchError> {
        let origin = match media {
            Media::Main => self.main.as_mut(),
            Media::Clean => self.clean.as_mut(),
        }
        .ok_or(FetchError::Unavailable)?;
        if origin.duration_ms > DECODE_ONCE_MS {
            return ffmpeg::decode(&self.ffmpeg, &origin.input.input(), start_ms, Some(len_ms), self.proxy.as_deref()).await;
        }
        if origin.whole.is_none() {
            // Always bounded by -t: a live stream of unknown length would otherwise read until the timeout.
            origin.whole = Some(ffmpeg::decode(&self.ffmpeg, &origin.input.input(), 0, Some(origin.duration_ms), self.proxy.as_deref()).await?);
        }
        let whole = origin.whole.as_deref().unwrap_or_default();
        let from = ((start_ms * STEREO_SAMPLES_PER_MS) as usize).min(whole.len());
        let to = (((start_ms + len_ms) * STEREO_SAMPLES_PER_MS) as usize).min(whole.len());
        Ok(whole[from..to].to_vec())
    }
}

#[derive(Deserialize)]
struct Limit {
    limit: Option<i64>,
}

async fn history(State(state): State<AppState>, Query(query): Query<Limit>) -> Result<Json<Value>, ApiError> {
    let data = state.data()?;
    let limit = query.limit.unwrap_or(HISTORY_DEFAULT).clamp(1, recognitions::KEEP);
    let rows = data.db.call(move |c| recognitions::list(c, limit)).await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({"id": r.id, "createdAt": iso_from_ms(r.created_at), "track": r.result})).collect();
    Ok(Json(json!({ "items": items })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| recognitions::delete(c, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Looked up per job, so installing a tool needs no restart; a build Nuvo keeps current comes first.
fn found_tools(state: &AppState) -> Tools {
    Tools::from_env(&ToolEnv { managed: state.env.managed.clone(), ..ToolEnv::from_process() })
}

async fn tool_versions(State(state): State<AppState>) -> Json<Value> {
    let found = found_tools(&state);
    let yt_dlp = match &found.yt_dlp {
        Some(path) => tools::version(path).await,
        None => None,
    };
    let ffmpeg = match &found.ffmpeg {
        Some(path) => tools::version(path).await,
        None => None,
    };
    Json(json!({"ytDlp": yt_dlp, "ffmpeg": ffmpeg}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_grant_lasts_ten_minutes_and_the_oldest_gives_way() {
        let grants = FileGrants::default();
        let start = Instant::now();
        let first = grants.put("/a.mp3".into(), start);
        assert_eq!(grants.get(&first, start + GRANT_TTL - Duration::from_secs(1)), Some("/a.mp3".into()));
        assert_eq!(grants.get(&first, start + GRANT_TTL), None);
        assert_eq!(grants.get("/a.mp3", start), None);

        let ids: Vec<String> = (0..=MAX_GRANTS as u64).map(|n| grants.put(format!("/{n}.mp3").into(), start + Duration::from_millis(n + 1))).collect();
        let now = start + Duration::from_secs(1);
        assert_eq!(grants.get(&ids[0], now), None);
        assert_eq!(grants.get(&ids[MAX_GRANTS], now), Some(format!("/{MAX_GRANTS}.mp3").into()));
    }
}
