use std::io::ErrorKind;
use std::process::{Output, Stdio};
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::FetchError;

/// Runs `command` to completion with no stdin. The child is killed when `timeout` passes, when
/// output exceeds caps, or when the returned future is dropped (a closed recognize stream drops it).
pub async fn run(
    mut command: Command,
    timeout: Duration,
    max_stdout: usize,
    max_stderr: usize,
) -> Result<Output, FetchError> {
    #[cfg(unix)]
    command.process_group(0);
    // No console window flashes up for a tool started from the GUI app.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command.kill_on_drop(true).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // A script still open for writing somewhere (a tool being updated, or a test writing its fake
    // while another thread forks) refuses to start for a moment: ETXTBSY.
    let mut spawned = command.spawn();
    for _ in 0..5 {
        match &spawned {
            Err(e) if e.kind() == ErrorKind::ExecutableFileBusy => {
                tokio::time::sleep(Duration::from_millis(20)).await;
                spawned = command.spawn();
            }
            _ => break,
        }
    }
    let mut child = spawned.map_err(|e| match e.kind() {
        ErrorKind::NotFound | ErrorKind::PermissionDenied => FetchError::ToolMissing(""),
        _ => FetchError::DecodeFailed(format!("cannot start: {e}")),
    })?;

    // Own process group: helpers the tool starts (yt-dlp's JS runtime) die with it.
    let mut group = GroupKill(child.id());
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let finish = async {
        let (out, err) = tokio::join!(read_limited(stdout, max_stdout), read_limited(stderr, max_stderr));
        let status = child.wait().await.map_err(|e| FetchError::DecodeFailed(e.to_string()))?;
        Ok::<_, FetchError>((out?, err?, status))
    };
    let (stdout_buf, stderr_buf, status) = match tokio::time::timeout(timeout, finish).await {
        Ok(Ok(done)) => done,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(FetchError::Network("timeout".into())),
    };
    // Reaped: the group id may be reused now, so nothing is left to kill.
    group.0 = None;

    Ok(Output {
        status,
        stdout: stdout_buf,
        stderr: stderr_buf,
    })
}

async fn read_limited<R: AsyncReadExt + Unpin>(
    mut reader: R,
    max_size: usize,
) -> Result<Vec<u8>, FetchError> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                if buf.len() + n > max_size {
                    return Err(FetchError::DecodeFailed("output exceeded cap".into()));
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            Err(e) => return Err(FetchError::DecodeFailed(e.to_string())),
        }
    }
    Ok(buf)
}

/// Kills the child's whole process group when dropped (timeout, size cap, closed stream).
struct GroupKill(Option<u32>);

impl Drop for GroupKill {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.0 {
            // SAFETY: plain syscall; the group was created by this child (process_group(0)).
            unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
        }
    }
}
