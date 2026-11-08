use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use nuvo_recognize::Limiter;
use tokio::time::Instant;

#[tokio::test(start_paused = true)]
async fn one_request_in_flight_and_spacing_between_them() {
    let limiter = Arc::new(Limiter::new(Duration::from_secs(2)));
    let in_flight = Arc::new(AtomicUsize::new(0));
    let begin = Instant::now();
    let mut tasks = Vec::new();
    for _ in 0..3 {
        let (limiter, in_flight) = (limiter.clone(), in_flight.clone());
        tasks.push(tokio::spawn(async move {
            limiter
                .run(async {
                    assert_eq!(in_flight.fetch_add(1, Ordering::SeqCst), 0, "two requests in flight");
                    let started = begin.elapsed();
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                    started
                })
                .await
        }));
    }
    let mut starts = Vec::new();
    for task in tasks {
        starts.push(task.await.unwrap());
    }
    starts.sort();
    assert_eq!(starts, [Duration::ZERO, Duration::from_millis(2100), Duration::from_millis(4200)]);
}

#[tokio::test(start_paused = true)]
async fn the_first_request_does_not_wait() {
    let limiter = Limiter::new(Duration::from_secs(2));
    let begin = Instant::now();
    limiter.run(async {}).await;
    assert_eq!(begin.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_request_still_counts_for_the_spacing() {
    let limiter = Limiter::new(Duration::from_secs(2));
    let begin = Instant::now();
    let cancelled = tokio::time::timeout(Duration::from_millis(10), limiter.run(tokio::time::sleep(Duration::from_secs(60)))).await;
    assert!(cancelled.is_err());
    limiter.run(async {}).await;
    assert_eq!(begin.elapsed(), Duration::from_secs(2));
}

#[tokio::test(start_paused = true)]
async fn a_deferred_wait_delays_the_next_request_of_any_job() {
    let limiter = Arc::new(Limiter::new(Duration::from_secs(2)));
    let begin = Instant::now();
    limiter.defer(Duration::from_secs(5)).await;
    let other = limiter.clone();
    let started = tokio::spawn(async move { other.run(async { begin.elapsed() }).await }).await.unwrap();
    assert_eq!(started, Duration::from_secs(5));
}
