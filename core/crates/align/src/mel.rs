use rustfft::FftPlanner;
use rustfft::num_complex::Complex;

pub const SAMPLE_RATE: usize = 16_000;
pub const N_FFT: usize = 400;
pub const HOP: usize = 160;
/// The encoder always reads 30 s: 3000 frames of 10 ms.
pub const WINDOW_SAMPLES: usize = 30 * SAMPLE_RATE;
pub const FRAMES: usize = WINDOW_SAMPLES / HOP;

/// Log-mel spectrogram of up to 30 s, zero-padded, laid out mel band by band.
pub fn log_mel(samples: &[f32], filters: &[f32], n_mels: usize) -> Vec<f32> {
    let bins = N_FFT / 2 + 1;
    assert_eq!(filters.len(), n_mels * bins, "filter bank size");
    let mut audio = vec![0.0; WINDOW_SAMPLES];
    let used = samples.len().min(WINDOW_SAMPLES);
    audio[..used].copy_from_slice(&samples[..used]);
    let pad = N_FFT / 2;
    // centred frames with reflected edges, as torch.stft(center=True) does
    let padded: Vec<f32> = (0..WINDOW_SAMPLES + 2 * pad)
        .map(|i| {
            let at = i as isize - pad as isize;
            let reflected = if at < 0 { -at } else if at >= WINDOW_SAMPLES as isize { 2 * (WINDOW_SAMPLES as isize - 1) - at } else { at };
            audio[reflected as usize]
        })
        .collect();
    let hann: Vec<f32> = (0..N_FFT).map(|i| 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / N_FFT as f32).cos())).collect();
    let fft = FftPlanner::<f32>::new().plan_fft_forward(N_FFT);
    let mut power = vec![0.0f32; bins];
    let mut buffer = vec![Complex::new(0.0, 0.0); N_FFT];
    let mut mel = vec![0.0f32; n_mels * FRAMES];
    for frame in 0..FRAMES {
        let start = frame * HOP;
        for (slot, (sample, weight)) in buffer.iter_mut().zip(padded[start..start + N_FFT].iter().zip(&hann)) {
            *slot = Complex::new(sample * weight, 0.0);
        }
        fft.process(&mut buffer);
        for (p, c) in power.iter_mut().zip(&buffer) {
            *p = c.norm_sqr();
        }
        for band in 0..n_mels {
            let energy: f32 = filters[band * bins..(band + 1) * bins].iter().zip(&power).map(|(f, p)| f * p).sum();
            mel[band * FRAMES + frame] = energy.max(1e-10).log10();
        }
    }
    let top = mel.iter().copied().fold(f32::MIN, f32::max);
    for value in &mut mel {
        *value = (value.max(top - 8.0) + 4.0) / 4.0;
    }
    mel
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_lights_the_band_that_holds_it() {
        let bins = N_FFT / 2 + 1;
        let mut filters = vec![0.0; 2 * bins];
        filters[25] = 1.0;
        filters[bins + 100] = 1.0;
        let tone: Vec<f32> = (0..SAMPLE_RATE).map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / SAMPLE_RATE as f32).sin()).collect();
        let mel = log_mel(&tone, &filters, 2);
        assert_eq!(mel.len(), 2 * FRAMES);
        let (low, high) = (mel[50], mel[FRAMES + 50]);
        assert!(low > high + 1.0, "1 kHz is FFT bin 25: {low} vs {high}");
        assert!(mel[FRAMES - 1] < low, "the padding is quieter than the tone");
    }
}
