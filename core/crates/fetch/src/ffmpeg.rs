//! ffmpeg decodes everything to 16 kHz stereo `s16le` on stdout; nothing touches the disk.

use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use tokio::process::Command;

use crate::process::run;
use crate::{FetchError, Remote, classify};

/// Length of a system audio or microphone recording.
pub const MONITOR_MS: u64 = 12_000;
const TIMEOUT: Duration = Duration::from_secs(60);

pub enum Input<'a> {
    File(&'a Path),
    Remote(&'a Remote),
    /// The default PipeWire/PulseAudio monitor: whatever the computer is playing.
    Monitor,
    /// The default PipeWire/PulseAudio source.
    Microphone,
}

fn seconds(ms: u64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

/// First stderr line with every word that holds a URL replaced; URLs can carry tokens.
fn first_line_redacted(stderr: &str) -> String {
    let line = stderr.lines().next().unwrap_or("ffmpeg failed");
    line.split(' ').map(|word| if word.contains("http://") || word.contains("https://") { "***" } else { word }).collect::<Vec<_>>().join(" ")
}

/// `-ss` (and `-t`) before `-i`, so ffmpeg seeks in the input and HTTP sources are read by range.
/// Header lines containing CR or LF are dropped: they come from the remote site via yt-dlp.
/// Proxy handling is done in `decode` via environment variables, not in arguments.
pub fn decode_args(input: &Input, start_ms: u64, len_ms: Option<u64>, _proxy: Option<&str>) -> Vec<OsString> {
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
            push(&mut args, &["-protocol_whitelist", "http,https,tcp,tls,crypto", "-max_redirects", "0", "-i", &remote.url]);
        }
    }
    push(&mut args, &["-vn", "-ac", "2", "-ar", "16000", "-f", "s16le", "-"]);
    args
}

/// Interleaved 16 kHz stereo samples of the input from `start_ms`, `len_ms` long (`None`: to the end).
pub async fn decode(ffmpeg: &Path, input: &Input<'_>, start_ms: u64, len_ms: Option<u64>, proxy: Option<&str>) -> Result<Vec<i16>, FetchError> {
    if let Input::Remote(remote) = input {
        if !(remote.url.starts_with("https://") || remote.url.starts_with("http://")) {
            return Err(FetchError::InvalidLink);
        }
        if let Some(proxy_url) = proxy {
            // ffmpeg only supports http:// proxies
            if !proxy_url.starts_with("http://") {
                return Err(FetchError::ProxyUnsupported);
            }
        }
    }
    let max_stdout = len_ms.map_or(10 * 60 * 16000 * 2 * 2, |l| l as usize * 64) + 64 * 1024;
    let mut command = Command::new(ffmpeg);
    command.args(decode_args(input, start_ms, len_ms, proxy));
    if let Some(proxy_url) = proxy
        && let Ok(parsed) = reqwest::Url::parse(proxy_url)
        && (parsed.scheme() == "http" || parsed.scheme() == "https")
    {
        // ffmpeg only uses http_proxy and https_proxy, socks not supported
        let proxy_without_creds = if let Some(port) = parsed.port() {
            format!("{}://{}:{}", parsed.scheme(), parsed.host_str().unwrap_or(""), port)
        } else {
            format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""))
        };
        command.env(format!("{}_proxy", parsed.scheme()), &proxy_without_creds);
    }
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
    Ok(output.stdout.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect())
}

/// Duration of a local file from ffmpeg's banner (`Duration: 00:03:21.45`). ffmpeg exits with an
/// error here because no output is given; only the banner matters. `Ok(None)` when it says `N/A`.
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
