// Electron may start the daemon without ~/.local/bin on PATH, where pip --user puts yt-dlp

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;

use crate::FetchError;
use crate::process::run;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tools {
    pub yt_dlp: Option<PathBuf>,
    pub ffmpeg: Option<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct ToolEnv {
    pub path: Option<OsString>,
    pub home: Option<PathBuf>,
    pub managed: Option<PathBuf>,
}

impl ToolEnv {
    pub fn from_process() -> Self {
        Self { path: std::env::var_os("PATH"), home: std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from), managed: None }
    }

    pub fn find(&self, name: &str) -> Option<PathBuf> {
        let managed = self.managed.as_ref().map(|dir| dir.join(name)).filter(|file| file.metadata().is_ok_and(|m| m.is_file() && is_executable(&m)));
        managed.or_else(|| find(name, self.path.as_deref(), self.home.as_deref()))
    }
}

impl Tools {
    /// Looks the tools up now; cheap enough to do per job, so installing one needs no restart.
    pub fn discover() -> Self {
        Self::from_env(&ToolEnv::from_process())
    }

    pub fn from_env(env: &ToolEnv) -> Self {
        Self { yt_dlp: env.find("yt-dlp"), ffmpeg: env.find("ffmpeg") }
    }

    pub fn require_ffmpeg(&self) -> Result<&Path, FetchError> {
        self.ffmpeg.as_deref().ok_or(FetchError::ToolMissing("ffmpeg"))
    }

    pub fn require_yt_dlp(&self) -> Result<&Path, FetchError> {
        self.yt_dlp.as_deref().ok_or(FetchError::ToolMissing("yt-dlp"))
    }
}

pub fn find(name: &str, path: Option<&OsStr>, home: Option<&Path>) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = path.map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    dirs.extend(home.map(|h| h.join(".local/bin")));
    dirs.into_iter()
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(file_name(name)))
        .find(|file| file.metadata().is_ok_and(|m| m.is_file() && is_executable(&m)))
}

#[cfg(unix)]
fn file_name(name: &str) -> String {
    name.to_string()
}

#[cfg(windows)]
fn file_name(name: &str) -> String {
    format!("{name}.exe")
}

#[cfg(unix)]
fn is_executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

// Windows has no execute bit; the `.exe` name is the test.
#[cfg(windows)]
fn is_executable(_: &std::fs::Metadata) -> bool {
    true
}

/// `yt-dlp --version` prints `2026.10.21`; `ffmpeg -version` starts `ffmpeg version 8.1.3 ...`.
pub async fn version(tool: &Path) -> Option<String> {
    let ffmpeg = tool.file_name().is_some_and(|n| n == "ffmpeg");
    let mut command = Command::new(tool);
    command.arg(if ffmpeg { "-version" } else { "--version" });
    let output = run(command, Duration::from_secs(15), 64 * 1024, 64 * 1024).await.ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?.trim();
    let version = if ffmpeg { line.strip_prefix("ffmpeg version ")?.split_whitespace().next()? } else { line };
    (output.status.success() && !version.is_empty()).then(|| version.to_string())
}

// The daemon adds `outdated` for an old yt-dlp, because that rule needs the clock
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCheck {
    pub name: &'static str,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
    pub status: &'static str,
    pub needed_by: &'static [&'static str],
}

/// yt-dlp needs one of these to solve YouTube's JavaScript challenges.
pub const JS_RUNTIMES: [&str; 3] = ["deno", "node", "bun"];

async fn stdout_of(tool: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut command = Command::new(tool);
    command.args(args);
    let output = run(command, timeout, 256 * 1024, 64 * 1024).await.ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

// ffmpeg -devices lists <flags> <name> <description>; D in the flags marks an input device
pub fn has_pulse_input(devices: &str) -> bool {
    devices.lines().any(|line| {
        let mut words = line.split_whitespace();
        matches!((words.next(), words.next()), (Some(flags), Some("pulse")) if flags.contains('D'))
    })
}

// Never fails: a problem is reported as a status
pub async fn check_all(env: &ToolEnv, timeout: Duration) -> Vec<ToolCheck> {
    let yt_dlp = async {
        let path = env.find("yt-dlp");
        let output = match &path {
            Some(path) => stdout_of(path, &["--version"], timeout).await,
            None => None,
        };
        let version = output.as_deref()
            .and_then(|text| text.lines().next())
            .map(|line| line.trim())
            .filter(|v| !v.is_empty() && v.len() <= 64)
            .map(|v| v.to_string());
        let status = match (&path, &version) {
            (None, _) => "missing",
            (Some(_), None) => "broken",
            (Some(_), Some(_)) => "ok",
        };
        ToolCheck { name: "yt-dlp", path, version, status, needed_by: &["recognize-links"] }
    };
    let ffmpeg = async {
        let path = env.find("ffmpeg");
        let (version, devices) = match &path {
            Some(path) => tokio::join!(stdout_of(path, &["-version"], timeout), stdout_of(path, &["-hide_banner", "-devices"], timeout)),
            None => (None, None),
        };
        let version = version.as_deref().and_then(|text| text.lines().next()?.strip_prefix("ffmpeg version ")?.split_whitespace().next().map(String::from));
        let status = match (&path, &version) {
            (None, _) => "missing",
            (Some(_), None) => "broken",
            (Some(_), Some(_)) => "ok",
        };
        let pulse = if status == "ok" && devices.as_deref().is_some_and(has_pulse_input) { "ok" } else { "missing" };
        let main = ToolCheck { name: "ffmpeg", path: path.clone(), version, status, needed_by: &["recognize", "whisper", "audio-analysis"] };
        let device = ToolCheck { name: "ffmpeg-pulse", path: None, version: None, status: pulse, needed_by: &["recognize-system-audio"] };
        (main, device)
    };
    let runtime = JS_RUNTIMES.iter().find_map(|name| env.find(name));
    let runtime = ToolCheck {
        name: "js-runtime",
        version: runtime.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()),
        status: if runtime.is_some() { "ok" } else { "missing" },
        path: runtime,
        needed_by: &["recognize-youtube-links"],
    };
    let (yt_dlp, (ffmpeg, pulse)) = tokio::join!(yt_dlp, ffmpeg);
    vec![yt_dlp, runtime, ffmpeg, pulse]
}
