use std::path::Path;

use nuvo_fetch::update::{TOOL_HOSTS, asset_for, checksum_of, deno_build_for, ffmpeg_build_for, unzip_member};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
const PLATFORMS: [(&str, &str); 6] = [("linux", "x86_64"), ("linux", "aarch64"), ("macos", "x86_64"), ("macos", "aarch64"), ("windows", "x86_64"), ("windows", "aarch64")];

fn host(url: &str) -> &str {
    url.strip_prefix("https://").and_then(|rest| rest.split('/').next()).unwrap_or("")
}

#[test]
fn every_desktop_platform_has_a_listed_yt_dlp_build() {
    let sums = std::fs::read_to_string(Path::new(FIXTURES).join("yt-dlp-SHA2-256SUMS")).unwrap();
    for (os, arch) in PLATFORMS {
        let asset = asset_for(os, arch).unwrap_or_else(|| panic!("no yt-dlp for {os} {arch}"));
        assert!(checksum_of(&sums, asset).is_some(), "{asset} is not in the release");
    }
    assert_eq!(asset_for("windows", "x86_64"), Some("yt-dlp.exe"));
    assert_eq!(asset_for("windows", "aarch64"), Some("yt-dlp_arm64.exe"));
    assert_eq!(asset_for("linux", "riscv64"), None);
}

#[test]
fn every_desktop_platform_has_pinned_ffmpeg_and_deno_from_allowed_hosts() {
    for (os, arch) in PLATFORMS {
        for build in [ffmpeg_build_for(os, arch), deno_build_for(os, arch)] {
            let build = build.unwrap_or_else(|| panic!("no build for {os} {arch}"));
            assert!(TOOL_HOSTS.contains(&host(build.url)), "{} is not an allowed host", build.url);
            assert!(build.sha256.len() == 64 && build.sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
            let program = build.member.rsplit('/').next().unwrap();
            assert_eq!(program.ends_with(".exe"), os == "windows", "{}", build.member);
        }
    }
    assert!(ffmpeg_build_for("linux", "riscv64").is_none() && deno_build_for("freebsd", "x86_64").is_none());
}

#[test]
fn one_member_is_unpacked_from_a_zip() {
    let archive = Path::new(FIXTURES).join("tools.zip");
    let out = tempfile::tempdir().unwrap();
    assert!(unzip_member(&archive, "pkg/bin/deno", &out.path().join("deno")).unwrap());
    assert_eq!(std::fs::read_to_string(out.path().join("deno")).unwrap(), "#!/bin/sh\necho 'deno 2.9.8 (stable, release, test)'\n");
    assert!(unzip_member(&archive, "readme.txt", &out.path().join("readme")).unwrap());
    assert_eq!(std::fs::read_to_string(out.path().join("readme")).unwrap(), "stored as is\n");
    assert!(!unzip_member(&archive, "deno", &out.path().join("other")).unwrap());
    assert!(!out.path().join("other").exists());
}

#[test]
fn a_file_that_is_not_a_zip_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let garbage = dir.path().join("garbage.zip");
    std::fs::write(&garbage, b"PK\x05\x06 too short").unwrap();
    assert!(unzip_member(&garbage, "deno", &dir.path().join("deno")).is_err());
    std::fs::write(&garbage, b"").unwrap();
    assert!(unzip_member(&garbage, "deno", &dir.path().join("deno")).is_err());
}
