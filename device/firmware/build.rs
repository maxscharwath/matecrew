use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn main() {
    embuild::espidf::sysenv::output();

    // The about page (both keys) shows when this firmware was built and from which commit.
    // `SOURCE_DATE_EPOCH` makes the build reproducible.
    let secs = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_secs())
        });
    let commit = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .unwrap_or_default();
    println!("cargo:rustc-env=MATECREW_BUILD={}", civil(secs));
    println!("cargo:rustc-env=MATECREW_COMMIT={commit}");
    // A new date whenever the firmware's code or screens change, not on every build.
    for path in ["src", "../core/src", "../ui/src", "../engine/src", "../dist", "../../.git/HEAD"] {
        println!("cargo:rerun-if-changed={path}");
    }
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");
}

/// "2026-10-10 09:12 UTC" for seconds since 1970 (days to civil date, proleptic Gregorian).
fn civil(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02} UTC",
        rem / 3_600,
        rem % 3_600 / 60
    )
}
