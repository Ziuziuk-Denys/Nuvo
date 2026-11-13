use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use tokio::process::Command;

use crate::process::run;
use crate::{FetchError, Remote, classify};

pub const MONITOR_MS: u64 = 12_000;
const TIMEOUT: Duration = Duration::from_secs(60);

pub enum Input<'a> {
    File(&'a Path),
    Remote(&'a Remote),
    Monitor,
    Microphone,
}

fn seconds(ms: u64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

// URLs can carry tokens, so every word holding one is redacted
fn first_line_redacted(stderr: &str) -> String {
    let line = stderr.lines().next().unwrap_or("ffmpeg failed");
    line.split(' ').map(|word| if word.contains("http://") || word.contains("https://") { "***" } else { word }).collect::<Vec<_>>().join(" ")
}

// -ss before -i so ffmpeg seeks the input; CR/LF headers from remote sites are dropped
pub fn decode_args(input: &Input, start_ms: u64, len_ms: Option<u64>, proxy: Option<&str>) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    let push = |args: &mut Vec<OsString>, items: &[&str]| args.extend(items.iter().map(OsString::from));
    push(&mut args, &["-nostdin", "-hide_banner", "-loglevel", "error"]);
    match input {
        Input::Monitor | Input::Microphone => {
            let cap_ms = len_ms.map_or(MONITOR_MS, |l| l.min(MONITOR_MS));
            let device = if matches!(input, Input::Monitor) { "@DEFAULT_MONITOR@" } else { "@DEFAULT_SOURCE@" };
            push(&mut args, &["-f", "pulse", "-t", &seconds(cap_ms), "-i", device]);
        }
        Input::File(path) => {
            push(&mut args, &["-ss", &seconds(start_ms)]);
            if let Some(len) = len_ms {
                push(&mut args, &["-t", &seconds(len)]);
            }
            push(&mut args, &["-protocol_whitelist", "file,crypto", "-i"]);
            args.push(format!("file:{}", path.display()).into());
        }
        Input::Remote(remote) => {
            let headers: String = remote
                .headers
                .iter()
                .filter(|(name, value)| !format!("{name}{value}").contains(['\r', '\n']))
                .map(|(name, value)| format!("{name}: {value}\r\n"))
                .collect();
            if !headers.is_empty() {
                push(&mut args, &["-headers", &headers]);
            }
            push(&mut args, &["-ss", &seconds(start_ms)]);
            if let Some(len) = len_ms {
                push(&mut args, &["-t", &seconds(len)]);
            }
            // TLS reaches an HTTP proxy through ffmpeg's `httpproxy` protocol.
            let whitelist = if proxy.is_some() { "http,https,tcp,tls,crypto,httpproxy" } else { "http,https,tcp,tls,crypto" };
            push(&mut args, &["-protocol_whitelist", whitelist, "-max_redirects", "0", "-i", &remote.url]);
        }
    }
    push(&mut args, &["-vn", "-ac", "2", "-ar", "16000", "-f", "s16le", "-"]);
    args
}

pub async fn decode(ffmpeg: &Path, input: &Input<'_>, start_ms: u64, len_ms: Option<u64>, proxy: Option<&str>) -> Result<Vec<i16>, FetchError> {
    if let Input::Remote(remote) = input
        && !(remote.url.starts_with("https://") || remote.url.starts_with("http://"))
    {
        return Err(FetchError::InvalidLink);
    }
    let max_stdout = len_ms.map_or(10 * 60 * 16000 * 2 * 2, |l| l as usize * 64) + 64 * 1024;
    let mut command = Command::new(ffmpeg);
    command.args(decode_args(input, start_ms, len_ms, proxy));
    // `proxy` is a plain HTTP proxy, a login included; the environment keeps the login out of argv.
    match proxy {
        Some(proxy) => command.env("http_proxy", proxy),
        None => command.env_remove("http_proxy"),
    };
    let output = run(command, TIMEOUT, max_stdout, 64 * 1024).await?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        // No audio server, no device, or the sandbox refused it: none of them is about the audio.
        if matches!(input, Input::Monitor | Input::Microphone) {
            return Err(FetchError::NoCapture);
        }
        return Err(match classify(&stderr) {
            network @ FetchError::Network(_) => network,
            _ => FetchError::DecodeFailed(first_line_redacted(&stderr)),
        });
    }
    if output.stdout.len() < 4 {
        return Err(FetchError::DecodeFailed("no audio".into()));
    }
    Ok(output.stdout.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b)).collect())
}

// ffmpeg exits with an error without an output; only its Duration banner line matters
pub async fn probe(ffmpeg: &Path, path: &Path) -> Result<Option<u64>, FetchError> {
    let mut command = Command::new(ffmpeg);
    command.args(["-nostdin", "-hide_banner", "-protocol_whitelist", "file,crypto", "-i"]);
    command.arg(format!("file:{}", path.display()));
    let output = run(command, Duration::from_secs(20), 64 * 1024, 64 * 1024).await?;
    parse_probe(&String::from_utf8_lossy(&output.stderr))
}

pub fn parse_probe(banner: &str) -> Result<Option<u64>, FetchError> {
    if !banner.contains("Audio:") {
        return Err(FetchError::DecodeFailed("no audio stream".into()));
    }
    let Some(at) = banner.find("Duration: ") else { return Ok(None) };
    let text = banner[at + "Duration: ".len()..].split(',').next().unwrap_or("");
    let parts: Vec<f64> = text.split(':').map(|p| p.trim().parse::<f64>()).collect::<Result<_, _>>().unwrap_or_default();
    let [h, m, s] = parts[..] else { return Ok(None) };
    Ok(Some(((h * 3600.0 + m * 60.0 + s) * 1000.0).round() as u64))
}

#[cfg(test)]
mod tests {
    use super::{Input, decode, decode_args, first_line_redacted};
    use crate::FetchError;
    use std::path::Path;

    #[tokio::test]
    async fn a_capture_that_cannot_start_says_so_whatever_ffmpeg_printed() {
        // `false` stands in for an ffmpeg that cannot open the device.
        let failed = decode(Path::new("/usr/bin/false"), &Input::Microphone, 0, Some(12_000), None).await;
        assert_eq!(failed, Err(FetchError::NoCapture));
    }

    #[test]
    fn captures_read_their_own_device_for_twelve_seconds_at_most() {
        for (input, device) in [(Input::Monitor, "@DEFAULT_MONITOR@"), (Input::Microphone, "@DEFAULT_SOURCE@")] {
            let args: Vec<String> = decode_args(&input, 0, Some(60_000), None).iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
            let at = args.iter().position(|arg| arg == "-t").unwrap();
            assert_eq!(args[at + 1], "12.000");
            assert!(args.iter().any(|arg| arg == device), "{args:?}");
        }
    }

    #[test]
    fn only_the_first_line_survives_without_urls() {
        let stderr = "Error opening input: https://cdn.x/a?token=s failed\nsecond http://y/z";
        assert_eq!(first_line_redacted(stderr), "Error opening input: *** failed");
        assert_eq!(first_line_redacted(""), "ffmpeg failed");
    }
}
