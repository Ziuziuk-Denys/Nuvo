use std::future::Future;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pace {
    pub spacing: Duration,
    /// Requests that may go out back to back before `refill` paces them.
    pub burst: u32,
    pub refill: Duration,
    /// Waits after the first, second and third HTTP 429 of a job; a fourth ends the job.
    pub backoff: [Duration; 3],
}

impl Pace {
    /// Shazam refuses a fifth request within about a minute and sends no Retry-After.
    pub const SHAZAM: Pace = Pace {
        spacing: Duration::from_secs(2),
        burst: 3,
        refill: Duration::from_secs(30),
        backoff: [Duration::from_secs(20), Duration::from_secs(30), Duration::from_secs(45)],
    };

    fn headroom(&self) -> Duration {
        self.refill * self.burst.saturating_sub(1)
    }
}

pub struct Limiter {
    pace: Pace,
    slots: Mutex<Slots>,
}

#[derive(Default)]
struct Slots {
    last: Option<Instant>,
    /// When the whole burst is available again.
    full: Option<Instant>,
}

impl Slots {
    fn next(&self, pace: &Pace) -> Option<Instant> {
        let spaced = self.last.map(|last| last + pace.spacing);
        let budget = self.full.and_then(|full| full.checked_sub(pace.headroom()));
        spaced.max(budget)
    }
}

impl Limiter {
    pub fn new(pace: Pace) -> Self {
        Self { pace, slots: Mutex::default() }
    }

    pub async fn wait(&self) -> Duration {
        let next = self.slots.lock().await.next(&self.pace);
        next.map_or(Duration::ZERO, |at| at.saturating_duration_since(Instant::now()))
    }

    pub async fn defer(&self, wait: Duration) {
        let until = Instant::now() + wait + self.pace.headroom();
        let mut slots = self.slots.lock().await;
        slots.full = Some(slots.full.map_or(until, |full| full.max(until)));
    }

    pub async fn run<T>(&self, request: impl Future<Output = T>) -> T {
        let mut slots = self.slots.lock().await;
        if let Some(at) = slots.next(&self.pace) {
            tokio::time::sleep_until(at).await;
        }
        let now = Instant::now();
        slots.full = Some(slots.full.map_or(now, |full| full.max(now)) + self.pace.refill);
        // Stamped before the await too: a cancelled request must not let the next one skip the spacing.
        slots.last = Some(now);
        let out = request.await;
        slots.last = Some(Instant::now());
        out
    }
}
