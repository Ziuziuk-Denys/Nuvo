#![cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use nuvo_fetch::FetchError;
use nuvo_fetch::process::run;
use tokio::process::Command;

fn alive(pid: &str) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => !stat.rsplit(')').next().is_some_and(|rest| rest.trim_start().starts_with('Z')),
        Err(_) => false,
    }
}

#[tokio::test]
async fn a_timeout_kills_the_tool_and_the_helpers_it_started() {
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("tool.sh");
    let pidfile = dir.path().join("helper.pid");
    std::fs::write(&script, format!("#!/bin/sh\n/usr/bin/sleep 600 &\necho $! > \"{}\"\nwait\n", pidfile.display())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

    let result = run(Command::new(&script), Duration::from_secs(1), 1024, 1024).await;
    assert!(matches!(result, Err(FetchError::Network(_))), "{result:?}");
    let pid = std::fs::read_to_string(&pidfile).unwrap().trim().to_string();
    for _ in 0..40 {
        if !alive(&pid) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the helper (pid {pid}) outlived its tool");
}
