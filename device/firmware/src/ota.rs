//! Updates over the network. The site announces its latest firmware with the
//! state (`DeviceState::firmware`). When it is newer than this one and has
//! not failed before, an idle terminal downloads it into the other app slot,
//! checks its size and SHA-256, and restarts on it.
//!
//! The new version starts "pending": the bootloader goes back to the old one
//! at the next restart unless the new one confirms itself, which it does
//! after its first sync. A version that did not make it is kept in NVS and
//! not tried again.

use anyhow::{bail, Result};
use esp_idf_svc::ota::EspOta;
use matecrew_core::contract::{is_newer_version, FirmwareRelease};
use sha2::{Digest, Sha256};

use crate::{api::Api, store::Store, FIRMWARE_VERSION};

/// Progress is drawn at these percentages only: each one is a panel refresh.
const STEPS: [u8; 3] = [25, 50, 75];

/// At boot: notes whether the last update came up or was rolled back.
pub fn check_boot(store: &Store) -> Result<()> {
    let Some(pending) = store.ota_pending()? else { return Ok(()) };
    if pending == FIRMWARE_VERSION {
        log::info!("ota: running {pending}, confirmed after the first sync");
    } else {
        log::warn!("ota: {pending} did not start, back on {FIRMWARE_VERSION}; it will not be tried again");
        store.set_ota_failed(&pending)?;
        store.set_ota_pending(None)?;
    }
    Ok(())
}

/// After a sync: this version works, the bootloader keeps it.
/// The app slot this firmware runs from ("ota_0" or "ota_1"), for the about page.
pub fn running_slot() -> Option<String> {
    let slot = EspOta::new().ok()?.get_running_slot().ok()?;
    Some(slot.label.as_str().to_owned())
}

pub fn confirm(store: &Store) -> Result<()> {
    EspOta::new()?.mark_running_slot_valid()?;
    if store.ota_pending()?.as_deref() == Some(FIRMWARE_VERSION) {
        store.set_ota_pending(None)?;
        log::info!("ota: {FIRMWARE_VERSION} confirmed");
    }
    Ok(())
}

/// The release to install, if the site has a newer one that has not failed here.
pub fn wanted<'a>(release: Option<&'a FirmwareRelease>, store: &Store) -> Option<&'a FirmwareRelease> {
    let release = release?;
    let failed = store.ota_failed().ok().flatten();
    (is_newer_version(&release.version, FIRMWARE_VERSION) && failed.as_deref() != Some(&release.version)).then_some(release)
}

/// Downloads `release` into the other slot and makes it the next to boot.
/// `progress` gets 25, 50 and 75 on the way.
pub fn install(api: &Api, release: &FirmwareRelease, mut progress: impl FnMut(u8)) -> Result<()> {
    let size = usize::try_from(release.size)?;
    let mut ota = EspOta::new()?;
    // Erases the other slot first: a few seconds.
    let mut update = ota.initiate_update_with_known_size(size)?;
    let mut hasher = Sha256::new();
    let mut written = 0usize;
    let mut steps = STEPS.iter().peekable();
    let downloaded = api.download(&release.url, |piece| {
        if written + piece.len() > size {
            bail!("firmware bigger than the {size} bytes announced");
        }
        update.write(piece)?;
        hasher.update(piece);
        written += piece.len();
        let percent = (written * 100 / size.max(1)) as u8;
        while steps.next_if(|step| percent >= **step).is_some() {
            progress(percent);
        }
        Ok(())
    });
    let sha256: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    let checked = downloaded.and_then(|()| {
        if written != size {
            bail!("firmware is {written} bytes, {size} announced");
        }
        if !sha256.eq_ignore_ascii_case(&release.sha256) {
            bail!("firmware SHA-256 is {sha256}, {} announced", release.sha256);
        }
        Ok(())
    });
    if let Err(e) = checked {
        let _ = update.abort();
        return Err(e);
    }
    update.complete()?;
    log::info!("ota: {} written ({size} bytes), next boot on it", release.version);
    Ok(())
}
