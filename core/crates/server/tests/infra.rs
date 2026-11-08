use std::collections::HashMap;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use nuvo_server::logging::RotatingFile;
use nuvo_server::paths::Paths;
use nuvo_server::socket;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    move |key| map.get(key).cloned()
}

#[test]
#[cfg(unix)]
fn paths_follow_xdg_defaults_and_overrides() {
    let defaults = Paths::from_env(env(&[("HOME", "/home/u"), ("XDG_RUNTIME_DIR", "/run/user/1")])).unwrap();
    assert_eq!(defaults.db, PathBuf::from("/home/u/.local/share/nuvo/library.db"));
    assert_eq!(defaults.audio, PathBuf::from("/home/u/.cache/nuvo/audio"));
    assert_eq!(defaults.log, PathBuf::from("/home/u/.local/state/nuvo/core.log"));
    assert_eq!(defaults.socket, PathBuf::from("/run/user/1/nuvo/core.sock"));

    let custom = Paths::from_env(env(&[
        ("HOME", "/home/u"),
        ("XDG_DATA_HOME", "/d"),
        ("XDG_CACHE_HOME", "relative/ignored"),
        ("NUVO_CORE_SOCKET", "/tmp/s.sock"),
    ]))
    .unwrap();
    assert_eq!(custom.db, PathBuf::from("/d/nuvo/library.db"));
    assert_eq!(custom.audio, PathBuf::from("/home/u/.cache/nuvo/audio"), "relative XDG values are ignored");
    assert_eq!(custom.socket, PathBuf::from("/tmp/s.sock"));

    assert!(Paths::from_env(env(&[("HOME", "/home/u")])).is_err(), "no runtime dir and no explicit socket");
}

#[test]
fn log_file_rotates_at_the_limit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("core.log");
    let mut log = RotatingFile::open(&path, 10).unwrap();
    log.write_all(b"12345678").unwrap();
    log.write_all(b"abcdef").unwrap();
    assert_eq!(std::fs::read(dir.path().join("core.log.1")).unwrap(), b"12345678");
    assert_eq!(std::fs::read(&path).unwrap(), b"abcdef");
}

#[tokio::test]
#[cfg(unix)]
async fn socket_is_private_replaces_stale_files_and_refuses_a_live_owner() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("run/core.sock");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"stale").unwrap();

    let listener = socket::bind(&path).await.unwrap();
    let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&path), 0o600);
    assert_eq!(mode(path.parent().unwrap()), 0o700);

    let err = socket::bind(&path).await.unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
    drop(listener);
}

#[tokio::test]
#[cfg(windows)]
async fn pipe_name_is_exclusive_and_must_be_a_pipe_path() {
    let name = format!(r"\\.\pipe\nuvo-test-{}", std::process::id());
    let first = socket::bind(std::path::Path::new(&name)).await.unwrap();
    let second = socket::bind(std::path::Path::new(&name)).await.err().expect("a live owner must refuse a second bind");
    assert_eq!(second.kind(), std::io::ErrorKind::AddrInUse);
    assert!(socket::bind(std::path::Path::new(r"C:\temp\core.sock")).await.is_err());
    drop(first);
}
