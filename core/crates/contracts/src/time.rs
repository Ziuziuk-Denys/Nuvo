/// `YYYY-MM-DDTHH:MM:SS.mmmZ`, the format `Date.prototype.toISOString` produces.
pub fn iso_from_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    let second_of_day = secs.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        second_of_day / 3600,
        second_of_day % 3600 / 60,
        second_of_day % 60
    )
}

/// Inverse of `iso_from_ms` for `YYYY-MM-DDTHH:MM:SS[.mmm]Z`; any other shape is `None`.
pub fn ms_from_iso(text: &str) -> Option<i64> {
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let digits = text.get(range)?;
        if !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        digits.parse().ok()
    };
    let b = text.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || b[b.len() - 1] != b'Z' {
        return None;
    }
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let millis = match text.get(19..text.len() - 1)? {
        "" => 0,
        fraction if fraction.len() == 4 && fraction.starts_with('.') => number(20..23)?,
        _ => return None,
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let seconds = days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second;
    Some(seconds * 1000 + millis)
}

/// Local hour (0-23) and weekday (0 = Sunday) for a JS `getTimezoneOffset()` value in minutes.
pub fn local_hour_weekday(utc_ms: i64, tz_offset_min: i64) -> (i64, i64) {
    let local_ms = utc_ms - tz_offset_min * 60_000;
    let hour = local_ms.div_euclid(3_600_000).rem_euclid(24);
    let weekday = (local_ms.div_euclid(86_400_000) + 4).rem_euclid(7);
    (hour, weekday)
}

/// Days since 1970-01-01 of the local day an instant falls on.
pub fn local_day(utc_ms: i64, tz_offset_min: i64) -> i64 {
    (utc_ms - tz_offset_min * 60_000).div_euclid(86_400_000)
}

/// `YYYY-MM-DD` of a day number.
pub fn iso_day(day: i64) -> String {
    let (year, month, date) = civil_from_days(day);
    format!("{year:04}-{month:02}-{date:02}")
}

/// Inverse of `iso_day`; any other shape, or a date that does not exist, is `None`.
pub fn day_from_iso(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let number = |range: std::ops::Range<usize>| text.get(range).filter(|d| d.bytes().all(|b| b.is_ascii_digit()))?.parse::<i64>().ok();
    let (year, month, date) = (number(0..4)?, number(5..7)?, number(8..10)?);
    if !(1..=12).contains(&month) || date == 0 {
        return None;
    }
    let day = days_from_civil(year, month, date);
    (iso_day(day) == text).then_some(day)
}

// Howard Hinnant's civil-to-days algorithm, the inverse of `civil_from_days`.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

// Howard Hinnant's days-to-civil algorithm, valid for the whole i64 day range we use.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
