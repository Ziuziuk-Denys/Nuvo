use std::future::Future;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::time::Instant;

/// Request pacing for the recognition endpoint.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pace {
    /// Minimum gap between the end of one request and the start of the next.
    pub spacing: Duration,
    /// Waits after the first, second and third HTTP 429 of a job; a fourth ends the job.
    pub backoff: [Duration; 3],
}

impl Pace {
    /// Shazam answers 429 after about 6 requests in 30 s.
    pub const SHAZAM: Pace = Pace {
        spacing: Duration::from_secs(2),
        backoff: [Duration::from_secs(5), Duration::from_secs(10), Duration::from_secs(20)],
    };
}

/// Daemon-wide gate: one request in flight, `spacing` between requests.
pub struct Limiter {
    spacing: Duration,
    last: Mutex<Option<Instant>>,
}

impl Limiter {
    pub fn new(spacing: Duration) -> Self {
        Self { spacing, last: Mutex::new(None) }
    }

    /// Global back-off: the next request from any job starts no earlier than `wait` from now.
    pub async fn defer(&self, wait: Duration) {
        let now = Instant::now();
        let ended = (now + wait).checked_sub(self.spacing).unwrap_or(now);
        let mut last = self.last.lock().await;
        *last = Some(last.map_or(ended, |l| l.max(ended)));
    }

    /// Runs `request` once no other request is in flight and `spacing` has passed since the last one ended.
    pub async fn run<T>(&self, request: impl Future<Output = T>) -> T {
        let mut last = self.last.lock().await;
        if let Some(ended) = *last {
            tokio::time::sleep_until(ended + self.spacing).await;
        }
        // Stamped before the await too: a cancelled request must not let the next one skip the spacing.
        *last = Some(Instant::now());
        let out = request.await;
        *last = Some(Instant::now());
        out
    }
}
