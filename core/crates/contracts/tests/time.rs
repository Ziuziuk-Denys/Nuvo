use nuvo_contracts::{iso_from_ms, local_hour_weekday};

#[test]
fn formats_unix_ms_as_utc_iso() {
    assert_eq!(iso_from_ms(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(iso_from_ms(951_782_400_000), "2000-02-29T00:00:00.000Z");
    assert_eq!(iso_from_ms(1_793_014_496_789), "2026-10-26T11:34:56.789Z");
    assert_eq!(iso_from_ms(-1), "1969-12-31T23:59:59.999Z");
}

#[test]
fn local_hour_and_weekday_follow_the_client_offset() {
    // 1970-01-01 00:30 UTC was a Thursday (weekday 4, Sunday = 0).
    assert_eq!(local_hour_weekday(30 * 60_000, 0), (0, 4));
    // JS getTimezoneOffset() is -120 for UTC+2: local time is 02:30 the same day.
    assert_eq!(local_hour_weekday(30 * 60_000, -120), (2, 4));
    // UTC-5 (offset 300) pushes it back to Wednesday 19:30.
    assert_eq!(local_hour_weekday(30 * 60_000, 300), (19, 3));
}

#[test]
fn iso_parsing_inverts_formatting() {
    use nuvo_contracts::ms_from_iso;
    for ms in [0, 1, 951_782_400_000, 1_700_000_000_123, 4_102_444_799_999, -86_400_000] {
        assert_eq!(ms_from_iso(&iso_from_ms(ms)), Some(ms), "{}", iso_from_ms(ms));
    }
    assert_eq!(ms_from_iso("2024-02-29T12:00:00Z"), Some(1_709_208_000_000));
    for bad in ["", "2024-02-29", "2024-02-29T12:00:00.1Z", "2024-13-01T00:00:00Z", "2024-02-29T12:00:00+01:00", "2024-02-29T25:00:00.000Z", "2024-02-2éT12:00:00Z"] {
        assert_eq!(ms_from_iso(bad), None, "{bad}");
    }
}
