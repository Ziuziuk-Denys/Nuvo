use nuvo_crypto::base64_decode;
use nuvo_recognize::signature::{Peak, SAMPLE_RATE, Signature, crc32, generate};

fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}

fn decode(bytes: &[u8]) -> Signature {
    let samples = word(bytes, 40) - 3840;
    let mut bands: [Vec<Peak>; 4] = Default::default();
    let mut at = 56;
    while at < bytes.len() {
        let band = (word(bytes, at) - 0x6003_0040) as usize;
        let size = word(bytes, at + 4) as usize;
        let data = &bytes[at + 8..at + 8 + size];
        let mut pass = 0u32;
        let mut i = 0;
        while i < data.len() {
            if data[i] == 0xff {
                pass = word(data, i + 1);
                i += 5;
                continue;
            }
            pass += data[i] as u32;
            let magnitude = u16::from_le_bytes([data[i + 1], data[i + 2]]);
            let bin = u16::from_le_bytes([data[i + 3], data[i + 4]]);
            bands[band].push(Peak { pass, magnitude, bin });
            i += 5;
        }
        at += 8 + size.next_multiple_of(4);
    }
    Signature { samples, bands }
}

#[test]
fn reencodes_a_real_request_byte_for_byte() {
    let uri = include_str!("fixtures/cassette-uri.txt").trim();
    let bytes = base64_decode(uri.strip_prefix("data:audio/vnd.shazam.sig;base64,").unwrap()).unwrap();
    assert_eq!(bytes.len(), 4724);
    let signature = decode(&bytes);
    assert_eq!(signature.samples, 192_000);
    assert_eq!(signature.duration_ms(), 12_000);
    assert_eq!(signature.encode(), bytes);
    assert_eq!(signature.data_uri(), uri);
}

#[test]
fn crc_matches_the_standard_check_value() {
    assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    assert_eq!(crc32(b""), 0);
}

#[test]
fn silence_has_no_peaks() {
    let signature = generate(&vec![0; 192_000]);
    assert!(signature.is_silent());
    assert_eq!(signature.samples, 192_000);
}

#[test]
fn a_pulsed_1_khz_tone_lands_in_band_1_near_1000_hz() {
    let tone: Vec<i16> = (0..192_000)
        .map(|n| {
            let t = n as f32 / SAMPLE_RATE as f32;
            let envelope = if (n / 4000) % 2 == 0 { 1.0 } else { 0.1 };
            (envelope * 8000.0 * (2.0 * std::f32::consts::PI * 1000.0 * t).sin()) as i16
        })
        .collect();
    let signature = generate(&tone);
    assert!(!signature.is_silent());
    assert!(!signature.bands[1].is_empty(), "1 kHz belongs to band 1");
    for peak in &signature.bands[1] {
        let hz = peak.bin as f32 * 0.122_070_31;
        assert!((hz - 1000.0).abs() < 20.0, "peak at {hz} Hz");
    }
    assert!(signature.bands[1].windows(2).all(|w| w[0].pass <= w[1].pass), "peaks are in time order");
}

#[test]
fn a_trailing_partial_hop_is_ignored() {
    assert_eq!(generate(&vec![0; 1000]).samples, 896);
}
