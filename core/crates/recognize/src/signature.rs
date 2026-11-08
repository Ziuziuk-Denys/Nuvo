//! Shazam audio signature: spectral peaks of 16 kHz mono audio, encoded in the
//! binary layout the recognition endpoint expects.

use std::sync::Arc;

use nuvo_crypto::base64_encode;
use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

pub const SAMPLE_RATE: u32 = 16_000;
const FFT_SIZE: usize = 2048;
const BINS: usize = FFT_SIZE / 2 + 1;
const HOP: usize = 128;
const RING: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Peak {
    pub pass: u32,
    pub magnitude: u16,
    pub bin: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub samples: u32,
    pub bands: [Vec<Peak>; 4],
}

struct Generator {
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    samples: [i16; FFT_SIZE],
    sample_pos: usize,
    buffer: Vec<Complex<f32>>,
    spectra: Vec<[f32; BINS]>,
    spectrum_pos: u8,
    spread: Vec<[f32; BINS]>,
    spread_pos: u8,
    passes: u32,
    bands: [Vec<Peak>; 4],
}

impl Generator {
    fn new() -> Self {
        // Symmetric Hann of 2049 points without its zero end points.
        let window = (0..FFT_SIZE)
            .map(|i| {
                let phase = 2.0 * std::f64::consts::PI * (i + 1) as f64 / (FFT_SIZE + 1) as f64;
                (0.5 - 0.5 * phase.cos()) as f32
            })
            .collect();
        Self {
            fft: FftPlanner::new().plan_fft_forward(FFT_SIZE),
            window,
            samples: [0; FFT_SIZE],
            sample_pos: 0,
            buffer: vec![Complex::default(); FFT_SIZE],
            spectra: vec![[0.0; BINS]; RING],
            spectrum_pos: 0,
            spread: vec![[0.0; BINS]; RING],
            spread_pos: 0,
            passes: 0,
            bands: Default::default(),
        }
    }

    fn feed(&mut self, chunk: &[i16]) {
        self.samples[self.sample_pos..self.sample_pos + HOP].copy_from_slice(chunk);
        self.sample_pos = (self.sample_pos + HOP) % FFT_SIZE;
        self.transform();
        self.spread_peaks();
        self.passes += 1;
        if self.passes >= 46 {
            self.find_peaks();
        }
    }

    fn transform(&mut self) {
        for (i, slot) in self.buffer.iter_mut().enumerate() {
            let sample = self.samples[(i + self.sample_pos) % FFT_SIZE] as f32;
            *slot = Complex::new(sample * self.window[i], 0.0);
        }
        self.fft.process(&mut self.buffer);
        let spectrum = &mut self.spectra[self.spectrum_pos as usize];
        for (out, value) in spectrum.iter_mut().zip(&self.buffer) {
            *out = (value.norm_sqr() / 131_072.0).max(1e-10);
        }
        self.spectrum_pos = self.spectrum_pos.wrapping_add(1);
    }

    fn spread_peaks(&mut self) {
        let mut current = self.spectra[self.spectrum_pos.wrapping_sub(1) as usize];
        for p in 0..BINS - 2 {
            current[p] = current[p].max(current[p + 1]).max(current[p + 2]);
        }
        self.spread[self.spread_pos as usize] = current;
        for back in [1u8, 3, 6] {
            let older = &mut self.spread[self.spread_pos.wrapping_sub(back) as usize];
            for (o, c) in older.iter_mut().zip(&current) {
                *o = o.max(*c);
            }
        }
        self.spread_pos = self.spread_pos.wrapping_add(1);
    }

    fn find_peaks(&mut self) {
        const NEAR: [isize; 8] = [-10, -7, -4, -3, 1, 2, 5, 8];
        const FAR: [i32; 14] = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
        let spectrum = &self.spectra[self.spectrum_pos.wrapping_sub(46) as usize];
        let spread = &self.spread[self.spread_pos.wrapping_sub(49) as usize];
        let pass = self.passes - 46;
        for bin in 10..=1014usize {
            let value = spectrum[bin];
            if value < 1.0 / 64.0 || value < spread[bin - 1] {
                continue;
            }
            let near = NEAR.iter().fold(0.0f32, |m, &o| m.max(spread[(bin as isize + o) as usize]));
            if value <= near {
                continue;
            }
            let far = FAR.iter().fold(near, |m, &o| {
                let frame = &self.spread[((self.spread_pos as i32 + o) & 255) as usize];
                m.max(frame[bin - 1])
            });
            if value <= far {
                continue;
            }
            let magnitude = log_magnitude(value);
            let before = log_magnitude(spectrum[bin - 1]);
            let after = log_magnitude(spectrum[bin + 1]);
            let curvature = magnitude * 2.0 - before - after;
            let offset = (after - before) * 32.0 / curvature;
            let corrected = (bin as i32 * 64 + offset as i32) as u16;
            let hz = corrected as f32 * (SAMPLE_RATE as f32 / 2.0 / 1024.0 / 64.0);
            let band = match hz as i32 {
                250..=519 => 0,
                520..=1449 => 1,
                1450..=3499 => 2,
                3500..=5500 => 3,
                _ => continue,
            };
            self.bands[band].push(Peak { pass, magnitude: magnitude as u16, bin: corrected });
        }
    }
}

fn log_magnitude(x: f32) -> f32 {
    x.ln().max(1.0 / 64.0) * 1477.3 + 6144.0
}

/// Signature of 16 kHz mono samples; a trailing partial hop is ignored.
pub fn generate(samples: &[i16]) -> Signature {
    let mut generator = Generator::new();
    let chunks = samples.chunks_exact(HOP);
    let used = chunks.len() * HOP;
    for chunk in chunks {
        generator.feed(chunk);
    }
    Signature { samples: used as u32, bands: generator.bands }
}

impl Signature {
    /// No peaks at all: silence or near silence, which Shazam can never match.
    pub fn is_silent(&self) -> bool {
        self.bands.iter().all(Vec::is_empty)
    }

    pub fn duration_ms(&self) -> u32 {
        (self.samples as u64 * 1000 / SAMPLE_RATE as u64) as u32
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(4096);
        let words: [u32; 12] = [
            0xcafe_2580,
            0, // crc, filled last
            0, // size after the header, filled last
            0x9411_9c00,
            0,
            0,
            0,
            3 << 27, // 16 kHz
            0,
            0,
            self.samples + (SAMPLE_RATE as f32 * 0.24) as u32,
            (15 << 19) + 0x40000,
        ];
        for word in words {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.extend_from_slice(&0x4000_0000u32.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        for (index, peaks) in self.bands.iter().enumerate() {
            if peaks.is_empty() {
                continue;
            }
            let data = encode_band(peaks);
            out.extend_from_slice(&(0x6003_0040 + index as u32).to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(&data);
            out.resize(out.len().next_multiple_of(4), 0);
        }
        let body_len = (out.len() - 48) as u32;
        out[8..12].copy_from_slice(&body_len.to_le_bytes());
        out[52..56].copy_from_slice(&body_len.to_le_bytes());
        let crc = crc32(&out[8..]);
        out[4..8].copy_from_slice(&crc.to_le_bytes());
        out
    }

    pub fn data_uri(&self) -> String {
        format!("data:audio/vnd.shazam.sig;base64,{}", base64_encode(&self.encode()))
    }
}

fn encode_band(peaks: &[Peak]) -> Vec<u8> {
    let mut data = Vec::with_capacity(peaks.len() * 5);
    let mut pass = 0u32;
    for peak in peaks {
        if peak.pass - pass >= 255 {
            data.push(0xff);
            data.extend_from_slice(&peak.pass.to_le_bytes());
            pass = peak.pass;
        }
        data.push((peak.pass - pass) as u8);
        data.extend_from_slice(&peak.magnitude.to_le_bytes());
        data.extend_from_slice(&peak.bin.to_le_bytes());
        pass = peak.pass;
    }
    data
}

/// CRC-32 (IEEE 802.3, reflected, as zlib and `crc32fast` compute it).
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}
