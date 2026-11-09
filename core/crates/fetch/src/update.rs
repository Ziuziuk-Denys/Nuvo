//! Keeps a private yt-dlp current from its official GitHub release. The binary is checked against
//! the release's own SHA2-256SUMS and has to run before it replaces the old one, so a failed
//! update leaves the last good build in place. Goes through the owner's proxy like every client.

use std::path::Path;

use reqwest::Client;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::tools::version;

pub const RELEASE_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
pub const BINARY_NAME: &str = "yt-dlp";
const SUMS_FILE: &str = "SHA2-256SUMS";
const SUMS_LIMIT: usize = 64 * 1024;
const BINARY_LIMIT: u64 = 256 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    #[error("no official build for this platform")]
    NoBuild,
    #[error("the release could not be read: {0}")]
    Network(String),
    #[error("the release lists no checksum for {0}")]
    NoChecksum(&'static str),
    #[error("the download does not match its checksum")]
    Checksum,
    #[error("the download is larger than any release")]
    TooLarge,
    #[error("the downloaded build does not run")]
    Broken,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    UpToDate,
    Installed,
}

/// The release asset that runs on `os` and `arch`, as `std::env::consts` names them.
pub fn asset_for(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("linux", "x86_64") => Some("yt-dlp_linux"),
        ("linux", "aarch64") => Some("yt-dlp_linux_aarch64"),
        ("macos", _) => Some("yt-dlp_macos"),
        _ => None,
    }
}

/// Lines of `<hex>  <file>`; a `*` before the file marks binary mode.
pub fn checksum_of(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, file) = line.trim().split_once(char::is_whitespace)?;
        let matches = file.trim().trim_start_matches('*') == asset;
        (matches && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

async fn file_hash(path: &Path) -> std::io::Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 256 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            return Ok(hex(&hasher.finalize()));
        }
        hasher.update(&buffer[..read]);
    }
}

async fn get(client: &Client, url: String) -> Result<reqwest::Response, UpdateError> {
    let response = client.get(url).send().await.map_err(|e| UpdateError::Network(e.without_url().to_string()))?;
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(UpdateError::Network(format!("HTTP {}", response.status().as_u16())))
    }
}

async fn read_sums(client: &Client, base: &str) -> Result<String, UpdateError> {
    let mut response = get(client, format!("{base}/{SUMS_FILE}")).await?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| UpdateError::Network(e.without_url().to_string()))? {
        body.extend_from_slice(&chunk);
        if body.len() > SUMS_LIMIT {
            return Err(UpdateError::TooLarge);
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// Streams `url` into `file`, reporting received and total bytes; returns the hash of what arrived.
async fn download(client: &Client, url: String, file: &Path, progress: &(dyn Fn(u64, Option<u64>) + Send + Sync)) -> Result<String, UpdateError> {
    let mut response = get(client, url).await?;
    let total = response.content_length();
    let mut out = tokio::fs::File::create(file).await?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    progress(0, total);
    while let Some(chunk) = response.chunk().await.map_err(|e| UpdateError::Network(e.without_url().to_string()))? {
        received += chunk.len() as u64;
        if received > BINARY_LIMIT {
            return Err(UpdateError::TooLarge);
        }
        hasher.update(&chunk);
        out.write_all(&chunk).await?;
        progress(received, total);
    }
    out.sync_all().await?;
    Ok(hex(&hasher.finalize()))
}

/// Brings `dir/yt-dlp` to the latest release of `base`. The rename is the only step that touches
/// the installed build, and it is atomic: yt-dlp running at that moment keeps its old file.
pub async fn update_yt_dlp(client: &Client, base: &str, asset: &'static str, dir: &Path, progress: &(dyn Fn(u64, Option<u64>) + Send + Sync)) -> Result<Outcome, UpdateError> {
    let base = base.trim_end_matches('/');
    let expected = checksum_of(&read_sums(client, base).await?, asset).ok_or(UpdateError::NoChecksum(asset))?;
    let installed = dir.join(BINARY_NAME);
    if file_hash(&installed).await.is_ok_and(|hash| hash == expected) {
        return Ok(Outcome::UpToDate);
    }
    tokio::fs::create_dir_all(dir).await?;
    // Named like the tool, so `version` asks for `--version`; the dot keeps it out of tool lookups.
    let partial = dir.join(format!(".{BINARY_NAME}.partial"));
    let result = install(client, format!("{base}/{asset}"), &partial, &installed, &expected, progress).await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial).await;
    }
    result.map(|()| Outcome::Installed)
}

#[cfg(unix)]
async fn make_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).await
}

// Windows runs a file by its extension; there is no executable bit.
#[cfg(windows)]
async fn make_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

async fn install(client: &Client, url: String, partial: &Path, installed: &Path, expected: &str, progress: &(dyn Fn(u64, Option<u64>) + Send + Sync)) -> Result<(), UpdateError> {
    if download(client, url, partial, progress).await? != expected {
        return Err(UpdateError::Checksum);
    }
    make_executable(partial).await?;
    if version(partial).await.is_none() {
        return Err(UpdateError::Broken);
    }
    tokio::fs::rename(partial, installed).await?;
    Ok(())
}

/// A pinned static ffmpeg: the archive, its SHA-256 and the folder inside it that holds `ffmpeg`.
#[derive(Debug, PartialEq, Eq)]
pub struct FfmpegBuild {
    pub url: &'static str,
    pub sha256: &'static str,
    pub folder: &'static str,
}

/// ffmpeg 7.0.2 static builds by John Van Sickle (GPLv3, kept at fixed addresses); the hashes are of
/// the archives as published, and the publisher's own md5 files agree with them. Linux only: other
/// systems keep using an installed ffmpeg.
pub fn ffmpeg_build_for(os: &str, arch: &str) -> Option<FfmpegBuild> {
    match (os, arch) {
        ("linux", "x86_64") => Some(FfmpegBuild {
            url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-7.0.2-amd64-static.tar.xz",
            sha256: "abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67",
            folder: "ffmpeg-7.0.2-amd64-static",
        }),
        ("linux", "aarch64") => Some(FfmpegBuild {
            url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-7.0.2-arm64-static.tar.xz",
            sha256: "f4149bb2b0784e30e99bdda85471c9b5930d3402014e934a5098b41d0f7201b1",
            folder: "ffmpeg-7.0.2-arm64-static",
        }),
        _ => None,
    }
}

/// Installs `dir/ffmpeg` from a pinned archive when there is none yet. The archive has to match its
/// hash, `tar` takes only the one file out, and the file has to run before it is put in place.
pub async fn install_ffmpeg(client: &Client, build: &FfmpegBuild, dir: &Path, progress: &(dyn Fn(u64, Option<u64>) + Send + Sync)) -> Result<Outcome, UpdateError> {
    let installed = dir.join("ffmpeg");
    if version(&installed).await.is_some() {
        return Ok(Outcome::UpToDate);
    }
    tokio::fs::create_dir_all(dir).await?;
    let archive = dir.join(".ffmpeg.partial.tar.xz");
    let staging = dir.join(".ffmpeg.staging");
    let result = unpack_ffmpeg(client, build, &archive, &staging, &installed, progress).await;
    let _ = tokio::fs::remove_file(&archive).await;
    let _ = tokio::fs::remove_dir_all(&staging).await;
    result.map(|()| Outcome::Installed)
}

async fn unpack_ffmpeg(client: &Client, build: &FfmpegBuild, archive: &Path, staging: &Path, installed: &Path, progress: &(dyn Fn(u64, Option<u64>) + Send + Sync)) -> Result<(), UpdateError> {
    if download(client, build.url.to_string(), archive, progress).await? != build.sha256 {
        return Err(UpdateError::Checksum);
    }
    tokio::fs::create_dir_all(staging).await?;
    let member = format!("{}/ffmpeg", build.folder);
    let status = tokio::process::Command::new("tar").arg("-xJf").arg(archive).arg("-C").arg(staging).arg(&member).status().await?;
    let unpacked = staging.join(&member);
    if !status.success() || !unpacked.is_file() {
        return Err(UpdateError::Broken);
    }
    make_executable(&unpacked).await?;
    if version(&unpacked).await.is_none() {
        return Err(UpdateError::Broken);
    }
    tokio::fs::rename(&unpacked, installed).await?;
    Ok(())
}
