// The binary must match the release SHA2-256SUMS and run before it replaces the old one

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use reqwest::header::RANGE;
use reqwest::{Client, RequestBuilder, StatusCode};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::tools::{exe_name, version};

pub const RELEASE_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
pub const BINARY_NAME: &str = "yt-dlp";
const SUMS_FILE: &str = "SHA2-256SUMS";
const SUMS_LIMIT: usize = 64 * 1024;
const BINARY_LIMIT: u64 = 256 * 1024 * 1024;

/// Every host a tool download may reach, redirects included.
pub const TOOL_HOSTS: [&str; 6] = ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "johnvansickle.com", "ffmpeg.martin-riedl.de", "huggingface.co"];
/// Hugging Face answers model downloads from regional CDN hosts under this domain.
pub const TOOL_HOST_SUFFIX: &str = ".hf.co";

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

pub type Progress<'a> = &'a (dyn Fn(u64, Option<u64>) + Send + Sync);

pub fn asset_for(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("linux", "x86_64") => Some("yt-dlp_linux"),
        ("linux", "aarch64") => Some("yt-dlp_linux_aarch64"),
        ("macos", _) => Some("yt-dlp_macos"),
        ("windows", "x86_64") => Some("yt-dlp.exe"),
        ("windows", "aarch64") => Some("yt-dlp_arm64.exe"),
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

async fn hash_into(path: &Path, hasher: &mut Sha256) -> std::io::Result<()> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut buffer = vec![0; 256 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            return Ok(());
        }
        hasher.update(&buffer[..read]);
    }
}

async fn file_hash(path: &Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    hash_into(path, &mut hasher).await?;
    Ok(hex(&hasher.finalize()))
}

fn network(err: reqwest::Error) -> UpdateError {
    UpdateError::Network(err.without_url().to_string())
}

fn success(response: reqwest::Response) -> Result<reqwest::Response, UpdateError> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(UpdateError::Network(format!("HTTP {}", response.status().as_u16())))
    }
}

async fn send(request: RequestBuilder) -> Result<reqwest::Response, UpdateError> {
    success(request.send().await.map_err(network)?)
}

async fn read_sums(client: &Client, base: &str) -> Result<String, UpdateError> {
    let mut response = send(client.get(format!("{base}/{SUMS_FILE}"))).await?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        body.extend_from_slice(&chunk);
        if body.len() > SUMS_LIMIT {
            return Err(UpdateError::TooLarge);
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

// A partial file left by a broken connection is continued with a Range request
async fn download(client: &Client, url: &str, file: &Path, limit: u64, progress: Progress<'_>) -> Result<String, UpdateError> {
    let have = tokio::fs::metadata(file).await.map_or(0, |m| m.len());
    let mut request = client.get(url);
    if have > 0 {
        request = request.header(RANGE, format!("bytes={have}-"));
    }
    let response = request.send().await.map_err(network)?;
    if response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
        tokio::fs::remove_file(file).await?;
    }
    let mut response = success(response)?;
    let mut hasher = Sha256::new();
    let (mut out, mut received) = if response.status() == StatusCode::PARTIAL_CONTENT {
        hash_into(file, &mut hasher).await?;
        (tokio::fs::OpenOptions::new().append(true).open(file).await?, have)
    } else {
        (tokio::fs::File::create(file).await?, 0)
    };
    let total = response.content_length().map(|length| length + received);
    progress(received, total);
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        received += chunk.len() as u64;
        if received > limit {
            return Err(UpdateError::TooLarge);
        }
        hasher.update(&chunk);
        out.write_all(&chunk).await?;
        progress(received, total);
    }
    out.sync_all().await?;
    Ok(hex(&hasher.finalize()))
}

/// A broken connection keeps the partial file so the next try continues it.
async fn keep_on_network_error(partial: &Path, result: Result<(), UpdateError>) -> Result<(), UpdateError> {
    if result.as_ref().is_err_and(|err| !matches!(err, UpdateError::Network(_))) {
        let _ = tokio::fs::remove_file(partial).await;
    }
    result
}

// Only the atomic rename touches the installed build; a running yt-dlp keeps its old file
pub async fn update_yt_dlp(client: &Client, base: &str, asset: &'static str, dir: &Path, progress: Progress<'_>) -> Result<Outcome, UpdateError> {
    let base = base.trim_end_matches('/');
    let expected = checksum_of(&read_sums(client, base).await?, asset).ok_or(UpdateError::NoChecksum(asset))?;
    let installed = dir.join(exe_name(BINARY_NAME));
    if file_hash(&installed).await.is_ok_and(|hash| hash == expected) {
        return Ok(Outcome::UpToDate);
    }
    tokio::fs::create_dir_all(dir).await?;
    // Named like the tool, so `version` asks for `--version`; the dot keeps it out of tool lookups.
    let partial = dir.join(format!(".{BINARY_NAME}.partial{}", std::env::consts::EXE_SUFFIX));
    let result = install(client, &format!("{base}/{asset}"), &partial, &installed, &expected, progress).await;
    keep_on_network_error(&partial, result).await.map(|()| Outcome::Installed)
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

async fn install(client: &Client, url: &str, partial: &Path, installed: &Path, expected: &str, progress: Progress<'_>) -> Result<(), UpdateError> {
    if download(client, url, partial, BINARY_LIMIT, progress).await? != expected {
        return Err(UpdateError::Checksum);
    }
    make_executable(partial).await?;
    if version(partial).await.is_none() {
        return Err(UpdateError::Broken);
    }
    tokio::fs::rename(partial, installed).await?;
    Ok(())
}

/// A pinned release archive and the path of the program inside it.
#[derive(Debug, PartialEq, Eq)]
pub struct Archive {
    pub url: &'static str,
    pub sha256: &'static str,
    pub member: &'static str,
}

// Static builds named on ffmpeg.org (John Van Sickle, Gyan Doshi) and Martin Riedl's signed macOS builds; all GPLv3
pub fn ffmpeg_build_for(os: &str, arch: &str) -> Option<Archive> {
    match (os, arch) {
        ("linux", "x86_64") => Some(Archive {
            url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-7.0.2-amd64-static.tar.xz",
            sha256: "abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67",
            member: "ffmpeg-7.0.2-amd64-static/ffmpeg",
        }),
        ("linux", "aarch64") => Some(Archive {
            url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-7.0.2-arm64-static.tar.xz",
            sha256: "f4149bb2b0784e30e99bdda85471c9b5930d3402014e934a5098b41d0f7201b1",
            member: "ffmpeg-7.0.2-arm64-static/ffmpeg",
        }),
        ("macos", "x86_64") => Some(Archive {
            url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip",
            sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
            member: "ffmpeg",
        }),
        ("macos", "aarch64") => Some(Archive {
            url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip",
            sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
            member: "ffmpeg",
        }),
        // Windows on Arm runs the x64 build through its emulator; there is no official arm64 one.
        ("windows", "x86_64" | "aarch64") => Some(Archive {
            url: "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
            sha256: "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
            member: "ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe",
        }),
        _ => None,
    }
}

// Deno 2.9.8 (MIT) from its GitHub release; the hashes match the release's own .sha256sum files
pub fn deno_build_for(os: &str, arch: &str) -> Option<Archive> {
    let (url, sha256) = match (os, arch) {
        ("linux", "x86_64") => (
            "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip",
            "e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609",
        ),
        ("linux", "aarch64") => (
            "https://github.com/denoland/deno/releases/download/v2.9.8/deno-aarch64-unknown-linux-gnu.zip",
            "d49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905",
        ),
        ("macos", "x86_64") => (
            "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-apple-darwin.zip",
            "4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c",
        ),
        ("macos", "aarch64") => (
            "https://github.com/denoland/deno/releases/download/v2.9.8/deno-aarch64-apple-darwin.zip",
            "9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e",
        ),
        ("windows", "x86_64") => (
            "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip",
            "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf",
        ),
        ("windows", "aarch64") => (
            "https://github.com/denoland/deno/releases/download/v2.9.8/deno-aarch64-pc-windows-msvc.zip",
            "b413b92b735b50c198e8fe3b85af1aa50e29d5f72e229aab701d132286e14cef",
        ),
        _ => return None,
    };
    Some(Archive { url, sha256, member: if os == "windows" { "deno.exe" } else { "deno" } })
}

// The archive must match its pinned hash, only the program is unpacked, and it must run before install
pub async fn install_archive(client: &Client, build: &Archive, name: &str, dir: &Path, force: bool, progress: Progress<'_>) -> Result<Outcome, UpdateError> {
    let installed = dir.join(exe_name(name));
    if !force && version(&installed).await.is_some() {
        return Ok(Outcome::UpToDate);
    }
    tokio::fs::create_dir_all(dir).await?;
    let kind = if build.url.ends_with(".zip") { "zip" } else { "tar.xz" };
    let archive = dir.join(format!(".{name}.partial.{kind}"));
    let staging = dir.join(format!(".{name}.staging"));
    let result = unpack(client, build, name, &archive, &staging, &installed, progress).await;
    let _ = tokio::fs::remove_dir_all(&staging).await;
    let result = keep_on_network_error(&archive, result).await;
    if result.is_ok() {
        let _ = tokio::fs::remove_file(&archive).await;
    }
    result.map(|()| Outcome::Installed)
}

async fn unpack(client: &Client, build: &Archive, name: &str, archive: &Path, staging: &Path, installed: &Path, progress: Progress<'_>) -> Result<(), UpdateError> {
    if download(client, build.url, archive, BINARY_LIMIT, progress).await? != build.sha256 {
        return Err(UpdateError::Checksum);
    }
    let _ = tokio::fs::remove_dir_all(staging).await;
    tokio::fs::create_dir_all(staging).await?;
    let unpacked = if build.url.ends_with(".zip") {
        let (archive, out, member) = (archive.to_path_buf(), staging.join(exe_name(name)), build.member);
        let found = tokio::task::spawn_blocking(move || unzip_member(&archive, member, &out).map(|found| found.then_some(out))).await.map_err(std::io::Error::other)??;
        found.ok_or(UpdateError::Broken)?
    } else {
        let status = tokio::process::Command::new("tar").arg("-xJf").arg(archive).arg("-C").arg(staging).arg(build.member).status().await?;
        if !status.success() {
            return Err(UpdateError::Broken);
        }
        staging.join(build.member)
    };
    if !unpacked.is_file() {
        return Err(UpdateError::Broken);
    }
    make_executable(&unpacked).await?;
    if version(&unpacked).await.is_none() {
        return Err(UpdateError::Broken);
    }
    tokio::fs::rename(&unpacked, installed).await?;
    Ok(())
}

/// A pinned data file, such as a speech model.
#[derive(Debug, PartialEq, Eq)]
pub struct Pinned {
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

// Multilingual Whisper models (MIT) in the whisper.cpp format, 8-bit, at a fixed revision of their repository
pub const WHISPER_BASE: Pinned = Pinned {
    name: "whisper-base",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q8_0.bin",
    sha256: "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9",
    bytes: 81_768_585,
};

pub const WHISPER_SMALL: Pinned = Pinned {
    name: "whisper-small",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q8_0.bin",
    sha256: "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f",
    bytes: 264_464_607,
};

/// Downloads `file` to `path` once; a file of the pinned size is taken as installed, since only a checked download is ever renamed there.
pub async fn install_pinned(client: &Client, file: &Pinned, path: &Path, progress: Progress<'_>) -> Result<Outcome, UpdateError> {
    if tokio::fs::metadata(path).await.is_ok_and(|m| m.len() == file.bytes) {
        return Ok(Outcome::UpToDate);
    }
    let dir = path.parent().ok_or_else(|| UpdateError::Io(std::io::Error::other("no folder for the file")))?;
    tokio::fs::create_dir_all(dir).await?;
    let partial = dir.join(format!(".{}.partial", file.name));
    let result = async {
        if download(client, file.url, &partial, file.bytes, progress).await? != file.sha256 {
            return Err(UpdateError::Checksum);
        }
        tokio::fs::rename(&partial, path).await?;
        Ok(())
    }
    .await;
    keep_on_network_error(&partial, result).await.map(|()| Outcome::Installed)
}

fn le16(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?).into())
}

fn le32(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?).into())
}

/// Writes one stored or deflated member of a zip archive to `out`; false when the archive has no such member.
pub fn unzip_member(archive: &Path, member: &str, out: &Path) -> std::io::Result<bool> {
    let bad = || std::io::Error::new(std::io::ErrorKind::InvalidData, "not a zip archive");
    let mut file = std::fs::File::open(archive)?;
    let length = file.metadata()?.len();
    let tail_length = length.min(22 + 0xFFFF);
    file.seek(SeekFrom::Start(length - tail_length))?;
    let mut tail = vec![0; tail_length as usize];
    file.read_exact(&mut tail)?;
    let end = tail.windows(4).rposition(|w| w == b"PK\x05\x06").ok_or_else(bad)?;
    let (size, offset) = (le32(&tail, end + 12).ok_or_else(bad)?, le32(&tail, end + 16).ok_or_else(bad)?);
    if offset + size > length {
        return Err(bad());
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut directory = vec![0; size as usize];
    file.read_exact(&mut directory)?;
    let mut at = 0;
    while directory.get(at..at + 4) == Some(b"PK\x01\x02") {
        let field = |offset| le16(&directory, at + offset).map(|v| v as usize).ok_or_else(bad);
        let (method, name_length, extra_length, comment_length) = (field(10)?, field(28)?, field(30)?, field(32)?);
        let compressed = le32(&directory, at + 20).ok_or_else(bad)?;
        let local = le32(&directory, at + 42).ok_or_else(bad)?;
        if directory.get(at + 46..at + 46 + name_length) == Some(member.as_bytes()) {
            file.seek(SeekFrom::Start(local))?;
            let mut header = [0; 30];
            file.read_exact(&mut header)?;
            if &header[..4] != b"PK\x03\x04" {
                return Err(bad());
            }
            let skip = le16(&header, 26).ok_or_else(bad)? + le16(&header, 28).ok_or_else(bad)?;
            file.seek(SeekFrom::Current(skip as i64))?;
            let data = (&mut file).take(compressed);
            let mut written = std::fs::File::create(out)?;
            match method {
                0 => std::io::copy(&mut data.take(BINARY_LIMIT), &mut written)?,
                8 => std::io::copy(&mut flate2::read::DeflateDecoder::new(data).take(BINARY_LIMIT), &mut written)?,
                _ => return Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "zip compression method")),
            };
            written.sync_all()?;
            return Ok(true);
        }
        at += 46 + name_length + extra_length + comment_length;
    }
    Ok(false)
}
