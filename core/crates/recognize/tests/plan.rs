mod common;

use nuvo_recognize::plan::{self, Candidate, ListenError, MAX_REQUESTS, Media, Outcome, Stage, WindowSource, candidates, listen};
use nuvo_recognize::{Shazam, Via};
use serde_json::json;

fn c(media: Media, start_ms: u64, len_ms: u64, via: Via) -> Candidate {
    Candidate { media, start_ms, len_ms, via }
}

#[test]
fn candidates_follow_the_spec_order() {
    let list = candidates(Some(180_000), Some(30_000), Via::Mix, 0);
    assert_eq!(
        list,
        [
            c(Media::Clean, 9_000, 12_000, Via::Clean),
            c(Media::Main, 84_000, 12_000, Via::Mix),
            c(Media::Main, 84_000, 12_000, Via::Side),
            c(Media::Main, 42_000, 12_000, Via::Mix),
            c(Media::Main, 42_000, 12_000, Via::Side),
            c(Media::Main, 126_000, 12_000, Via::Mix),
            c(Media::Main, 126_000, 12_000, Via::Side),
        ]
    );
    assert!(plan::has_more(Some(180_000), 0));
    assert!(!plan::has_more(Some(180_000), 1));
}

#[test]
fn short_media_is_sent_whole_once_per_channel() {
    assert_eq!(candidates(Some(8_000), None, Via::Mix, 0), [c(Media::Main, 0, 8_000, Via::Mix), c(Media::Main, 0, 8_000, Via::Side)]);
    assert_eq!(candidates(Some(12_000), None, Via::System, 0), [c(Media::Main, 0, 12_000, Via::System), c(Media::Main, 0, 12_000, Via::Side)]);
    assert!(!plan::has_more(Some(12_000), 0));
}

#[test]
fn another_part_uses_new_positions_and_skips_the_clean_sound() {
    let starts: Vec<u64> = candidates(Some(112_000), Some(30_000), Via::Mix, 1).iter().map(|c| c.start_ms).collect();
    assert_eq!(starts, [37_500, 37_500, 62_500, 62_500, 12_500, 12_500, 87_500, 87_500]);
    assert_eq!(candidates(None, Some(30_000), Via::Mix, 0), [c(Media::Clean, 9_000, 12_000, Via::Clean)]);
}

#[test]
fn side_gate_envelope_and_channel_math() {
    let tone = common::pulsed_tone(1000.0, 16_000);
    let identical: Vec<i16> = tone.iter().flat_map(|&s| [s, s]).collect();
    assert!(!plan::side_is_audible(&identical));
    let wide: Vec<i16> = tone.iter().flat_map(|&s| [s, 0]).collect();
    assert!(plan::side_is_audible(&wide));
    // Side at -40 dB: one channel 2 % louder than the other.
    let narrow: Vec<i16> = tone.iter().flat_map(|&s| [s, (s as f32 * 0.98) as i16]).collect();
    assert!(!plan::side_is_audible(&narrow));

    assert_eq!(plan::mix(&[100, 300, -4, 4]), [200, 0]);
    assert_eq!(plan::side(&[100, 300, -4, 4]), [-100, -4]);

    let envelope = plan::envelope(&tone);
    assert_eq!(envelope.len(), 48);
    assert!(envelope.iter().all(|&v| (0.0..=1.0).contains(&v)));
    assert!(envelope[0] > 0.2, "loud start: {}", envelope[0]);
    assert_eq!(plan::envelope(&[]), vec![0.0; 48]);
}

/// Stereo test audio: identical channels, or a different tone on each side.
struct Fake {
    wide: bool,
    silent: bool,
    loads: Vec<(Media, u64)>,
}

impl Fake {
    fn new(wide: bool) -> Self {
        Self { wide, silent: false, loads: Vec::new() }
    }
}

impl WindowSource for Fake {
    type Error = String;

    async fn window(&mut self, media: Media, start_ms: u64, len_ms: u64) -> Result<Vec<i16>, String> {
        self.loads.push((media, start_ms));
        let samples = (len_ms * 16) as usize;
        if self.silent {
            return Ok(vec![0; samples * 2]);
        }
        let left = common::pulsed_tone(1000.0, samples);
        let right = if self.wide { common::pulsed_tone(2500.0, samples) } else { left.clone() };
        Ok(left.iter().zip(&right).flat_map(|(&l, &r)| [l, r]).collect())
    }
}

async fn run(replies: Vec<(u16, serde_json::Value)>, source: &mut Fake, list: &[Candidate]) -> (Result<Outcome, ListenError<String>>, Vec<Stage>, usize) {
    let mock = common::mock_shazam(replies).await;
    let shazam = Shazam::new(&mock.url, common::FAST);
    let mut stages = Vec::new();
    let outcome = listen(&shazam, source, list, |stage| stages.push(stage)).await;
    (outcome, stages, mock.count())
}

fn vias(stages: &[Stage]) -> Vec<Via> {
    stages.iter().filter_map(|s| if let Stage::Listening { via, .. } = s { Some(*via) } else { None }).collect()
}

#[tokio::test]
async fn stops_at_the_first_match() {
    let mut source = Fake::new(true);
    let list = candidates(Some(60_000), None, Via::Mix, 0);
    let (outcome, stages, requests) = run(vec![(200, common::no_match()), (200, common::found())], &mut source, &list).await;
    let Ok(Outcome::Found { song, via }) = outcome else { panic!("expected a match") };
    assert_eq!((song.title.as_str(), via), ("I Will Survive", Via::Side));
    assert_eq!(requests, 2);
    assert_eq!(vias(&stages), [Via::Mix, Via::Side]);
    assert_eq!(source.loads, [(Media::Main, 24_000)], "mix and side share one decoded window");
    let Stage::Listening { attempt, of, envelope, .. } = &stages[1] else { panic!() };
    assert_eq!((*attempt, *of, envelope.len()), (2, 6, 48));
}

#[tokio::test]
async fn identical_channels_skip_the_side_channel() {
    let mut source = Fake::new(false);
    let list = candidates(Some(60_000), None, Via::Mix, 0);
    let (outcome, stages, requests) = run(vec![], &mut source, &list).await;
    assert!(matches!(outcome, Ok(Outcome::NotFound)));
    assert_eq!(requests, 3);
    assert_eq!(vias(&stages), [Via::Mix, Via::Mix, Via::Mix]);
    let Stage::Listening { of, .. } = stages.last().unwrap() else { panic!() };
    assert_eq!(*of, 4, "skipped side windows shrink the estimate; side 75 % is not judged yet");
}

#[tokio::test]
async fn never_more_than_six_requests() {
    let mut source = Fake::new(true);
    let list = candidates(Some(180_000), Some(30_000), Via::Mix, 0);
    assert_eq!(list.len(), 7);
    let (outcome, stages, requests) = run(vec![], &mut source, &list).await;
    assert!(matches!(outcome, Ok(Outcome::NotFound)));
    assert_eq!(requests, MAX_REQUESTS);
    assert_eq!(vias(&stages), [Via::Clean, Via::Mix, Via::Side, Via::Mix, Via::Side, Via::Mix]);
}

#[tokio::test]
async fn rate_limits_are_waited_out_then_end_the_job() {
    let limited = || (429, json!({}));
    let list = candidates(Some(60_000), None, Via::Mix, 0);

    let (outcome, stages, requests) = run(vec![limited(), (200, common::found())], &mut Fake::new(true), &list).await;
    assert!(matches!(outcome, Ok(Outcome::Found { via: Via::Mix, .. })), "the same window is retried");
    assert_eq!(requests, 2);
    assert!(matches!(stages[1], Stage::Waiting { seconds: 1 }));

    let (outcome, stages, requests) = run(vec![limited(), limited(), limited(), limited()], &mut Fake::new(true), &list).await;
    assert!(matches!(outcome, Err(ListenError::Busy)));
    assert_eq!(requests, 4);
    assert_eq!(stages.iter().filter(|s| matches!(s, Stage::Waiting { .. })).count(), 3);
}

#[tokio::test]
async fn silence_sends_nothing() {
    let mut source = Fake::new(true);
    source.silent = true;
    let list = candidates(Some(12_000), None, Via::System, 0);
    let (outcome, stages, requests) = run(vec![], &mut source, &list).await;
    assert!(matches!(outcome, Ok(Outcome::NotFound)));
    assert_eq!((requests, stages.len()), (0, 0));
}

#[tokio::test]
async fn audio_errors_end_the_job() {
    struct Broken;
    impl WindowSource for Broken {
        type Error = String;
        async fn window(&mut self, _: Media, _: u64, _: u64) -> Result<Vec<i16>, String> {
            Err("decode_failed".into())
        }
    }
    let shazam = Shazam::new("http://127.0.0.1:9", common::FAST);
    let list = candidates(Some(60_000), None, Via::Mix, 0);
    let outcome = listen(&shazam, &mut Broken, &list, |_| {}).await;
    assert!(matches!(outcome, Err(ListenError::Audio(e)) if e == "decode_failed"));
}
