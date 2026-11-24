use std::sync::atomic::AtomicBool;
use std::time::Duration;

use nuvo_recs::mood;
use nuvo_store::now_ms;

use crate::state::{AppState, Unlocked};
use crate::word_timing::{audio_source, decode};

const START_DELAY: Duration = Duration::from_secs(45);
const BETWEEN_SONGS: Duration = Duration::from_secs(1);
const WHEN_IDLE: Duration = Duration::from_secs(120);

pub fn spawn(state: AppState) {
    let weak = state.downgrade();
    drop(state);
    tokio::spawn(async move {
        let mut wait = START_DELAY;
        loop {
            tokio::time::sleep(wait).await;
            let Some(state) = AppState::upgrade(&weak) else { return };
            wait = match measure_next(&state).await {
                true => BETWEEN_SONGS,
                false => WHEN_IDLE,
            };
        }
    });
}

async fn measure_next(state: &AppState) -> bool {
    let Ok(data) = state.data() else { return false };
    let Some(ffmpeg) = state.env.find("ffmpeg") else { return false };
    let Ok(Some(id)) = data.db.call(mood::next_due).await else { return false };
    let found = measure(&data, &ffmpeg, &id).await;
    data.db.call(move |c| mood::store(c, &id, found, now_ms())).await.is_ok()
}

async fn measure(data: &Unlocked, ffmpeg: &std::path::Path, id: &str) -> Option<mood::Sound> {
    let only_what_is_here = AtomicBool::new(true);
    let audio = audio_source(data, id, &only_what_is_here).await.ok()?;
    let samples = decode(ffmpeg, audio).await.ok()?;
    tokio::task::spawn_blocking(move || nuvo_align::with_low_priority(|| mood::measure(&samples))).await.ok()?.ok()?
}
