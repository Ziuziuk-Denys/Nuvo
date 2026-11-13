use std::io::ErrorKind;
use std::process::{Output, Stdio};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::FetchError;

// The child is killed on timeout, on output over caps, or when the future is dropped
pub async fn run(command: Command, timeout: Duration, max_stdout: usize, max_stderr: usize) -> Result<Output, FetchError> {
    run_with_input(command, None, timeout, max_stdout, max_stderr).await
}

/// Like `run`, with `input` written to the child's stdin while its output is read.
pub async fn run_with_input(
    mut command: Command,
    input: Option<Vec<u8>>,
    timeout: Duration,
    max_stdout: usize,
    max_stderr: usize,
) -> Result<Output, FetchError> {
    #[cfg(unix)]
    command.process_group(0);
    // No console window flashes up for a tool started from the GUI app.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command.kill_on_drop(true).stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    // A script still open for writing refuses to start for a moment (ETXTBSY)
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
    let stdin = child.stdin.take();

    let finish = async {
        // A child that stops reading early (bad input) closes the pipe; its exit status tells what went wrong.
        let feed = async move {
            if let (Some(mut stdin), Some(input)) = (stdin, input) {
                let _ = stdin.write_all(&input).await;
            }
        };
        let (out, err, ()) = tokio::join!(read_limited(stdout, max_stdout), read_limited(stderr, max_stderr), feed);
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
