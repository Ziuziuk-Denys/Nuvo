use std::ffi::OsString;
use std::path::{Path, PathBuf};

use nuvo_fetch::ffmpeg::{Input, decode, decode_args, parse_probe, probe};
use nuvo_fetch::{FetchError, Remote, Tools};

fn strings(args: Vec<OsString>) -> Vec<String> {
    args.into_iter().map(|a| a.into_string().unwrap()).collect()
}

#[test]
fn seeks_before_the_input_and_writes_raw_stereo_16k() {
    let file = strings(decode_args(&Input::File(Path::new("/m/clip.mp4")), 84_000, Some(12_000), None));
    assert_eq!(
        file,
        ["-nostdin", "-hide_banner", "-loglevel", "error", "-ss", "84.000", "-t", "12.000", "-protocol_whitelist", "file,crypto", "-i", "file:/m/clip.mp4", "-vn", "-ac", "2", "-ar", "16000", "-f", "s16le", "-"]
    );
    let whole = strings(decode_args(&Input::File(Path::new("/m/a.wav")), 0, None, None));
    assert_eq!(whole[4..9], ["-ss", "0.000", "-protocol_whitelist", "file,crypto", "-i"]);

    let remote = Remote {
        url: "https://cdn/a.m4a".into(),
        headers: vec![("Referer".into(), "https://www.tiktok.com/".into()), ("X-Evil".into(), "a\r\nHost: internal".into())],
    };
    let args = strings(decode_args(&Input::Remote(&remote), 1_500, Some(12_000), None));
    assert_eq!(args[4..16], ["-headers", "Referer: https://www.tiktok.com/\r\n", "-ss", "1.500", "-t", "12.000", "-protocol_whitelist", "http,https,tcp,tls,crypto", "-max_redirects", "0", "-i", "https://cdn/a.m4a"]);

    let proxied = strings(decode_args(&Input::Remote(&remote), 0, None, Some("http://user:pass@10.0.0.2:3128")));
    assert_eq!(proxied[8..12], ["-protocol_whitelist", "http,https,tcp,tls,crypto,httpproxy", "-max_redirects", "0"]);
    assert!(!proxied.contains(&"user".to_string()), "no credentials in argv");
    assert!(!proxied.contains(&"pass".to_string()), "no credentials in argv");
    let file_proxied = strings(decode_args(&Input::File(Path::new("/m/a.wav")), 0, None, Some("http://10.0.0.2:3128")));
    assert_eq!(file_proxied[4..9], ["-ss", "0.000", "-protocol_whitelist", "file,crypto", "-i"]);

    let monitor = strings(decode_args(&Input::Monitor, 0, None, None));
    assert_eq!(monitor[4..10], ["-f", "pulse", "-t", "12.000", "-i", "@DEFAULT_MONITOR@"]);

    let monitor_capped = strings(decode_args(&Input::Monitor, 0, Some(5_000), None));
    assert_eq!(monitor_capped[7], "5.000", "monitor cap: 5 seconds < 12 second default");
}

#[test]
fn reads_duration_and_audio_from_the_banner() {
    let banner = "Input #0, mov,mp4, from 'a.mp4':\n  Duration: 00:03:21.45, start: 0.000000, bitrate: 128 kb/s\n  Stream #0:0: Audio: aac (LC), 44100 Hz, stereo\nAt least one output file must be specified\n";
    assert_eq!(parse_probe(banner), Ok(Some(201_450)));
    assert_eq!(parse_probe("  Duration: N/A, bitrate: N/A\n  Stream #0:0: Audio: opus\n"), Ok(None));
    assert_eq!(parse_probe("  Duration: 00:00:05.00\n  Stream #0:0: Video: h264\n"), Err(FetchError::DecodeFailed("no audio stream".into())));
}

fn ffmpeg() -> Option<PathBuf> {
    Tools::discover().ffmpeg
}

fn write_wav(path: &Path, rate: u32, seconds: u32, left: impl Fn(u32) -> i16, right: impl Fn(u32) -> i16) {
    let frames = rate * seconds;
    let mut bytes = Vec::with_capacity(44 + frames as usize * 4);
    let data_len = frames * 4;
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 4).to_le_bytes());
    bytes.extend_from_slice(&4u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for n in 0..frames {
        bytes.extend_from_slice(&left(n).to_le_bytes());
        bytes.extend_from_slice(&right(n).to_le_bytes());
    }
    std::fs::write(path, bytes).unwrap();
}

#[tokio::test]
async fn decodes_files_whole_and_by_range() {
    let Some(ffmpeg) = ffmpeg() else {
        eprintln!("Skipped: ffmpeg is required (dnf install ffmpeg)");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let wav = dir.path().join("tone.wav");
    let tone = |n: u32| ((n as f32 * 440.0 * std::f32::consts::TAU / 44_100.0).sin() * 10_000.0) as i16;
    write_wav(&wav, 44_100, 3, tone, |_| 0);

    assert_eq!(probe(&ffmpeg, &wav).await, Ok(Some(3_000)));
    let whole = decode(&ffmpeg, &Input::File(&wav), 0, None, None).await.unwrap();
    assert!((whole.len() as i64 - 96_000).abs() <= 64, "3 s of 16 kHz stereo, got {}", whole.len());
    assert!(whole.as_chunks::<2>().0.iter().any(|lr| lr[0].abs() > 5_000), "left carries the tone");
    assert!(whole.as_chunks::<2>().0.iter().all(|lr| lr[1].abs() < 50), "right stays silent");

    let window = decode(&ffmpeg, &Input::File(&wav), 1_000, Some(1_000), None).await.unwrap();
    assert!((window.len() as i64 - 32_000).abs() <= 64, "1 s window, got {}", window.len());

    let text = dir.path().join("notes.txt");
    std::fs::write(&text, "not audio").unwrap();
    assert!(matches!(probe(&ffmpeg, &text).await, Err(FetchError::DecodeFailed(_))));
    assert!(matches!(decode(&ffmpeg, &Input::File(&text), 0, None, None).await, Err(FetchError::DecodeFailed(_))));
}

#[tokio::test]
async fn remote_inputs_must_be_http() {
    let remote = Remote { url: "file:///etc/passwd".into(), headers: vec![] };
    assert_eq!(decode(Path::new("/bin/false"), &Input::Remote(&remote), 0, None, None).await, Err(FetchError::InvalidLink));
}
