//! UTC timestamps in ISO 8601, without a date library. The terminal sets its
//! clock from the site's `serverTime` and stamps takes with it.

/// Seconds since 1970 for "2026-10-09T18:25:00.000Z"; fractions are dropped.
pub fn parse_iso(s: &str) -> Option<i64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut date = date.splitn(3, '-').map(str::parse::<i64>);
    let (year, month, day) = (date.next()?.ok()?, date.next()?.ok()?, date.next()?.ok()?);
    let time = time.split('.').next()?;
    let mut time = time.splitn(3, ':').map(str::parse::<i64>);
    let (hour, minute, second) = (time.next()?.ok()?, time.next()?.ok()?, time.next()?.ok()?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// "2026-10-09T18:25:00Z" for seconds since 1970.
pub fn format_iso(seconds: i64) -> String {
    let (days, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

// Howard Hinnant's algorithms: https://howardhinnant.github.io/date_algorithms.html
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_site_s_server_time() {
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso("2026-10-09T18:25:00.123Z"), Some(1_791_570_300));
        assert_eq!(parse_iso("2024-02-29T12:00:00Z"), Some(1_709_208_000));
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        assert_eq!(parse_iso("2026-10-09 18:25:00"), None);
        assert_eq!(parse_iso("2026-13-09T18:25:00Z"), None);
        assert_eq!(parse_iso("2026-10-09T18:25:00+02:00"), None);
    }

    #[test]
    fn formats_what_it_parses() {
        for s in ["1970-01-01T00:00:00Z", "2026-10-09T18:25:00Z", "2024-02-29T23:59:59Z", "2100-03-01T00:00:00Z"] {
            assert_eq!(format_iso(parse_iso(s).unwrap()), s);
        }
    }
}
