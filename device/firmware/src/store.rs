//! Settings kept in NVS across reboots and deep sleep. What the site can send again (the last
//! state, the app) is a cache: declared in `cache.rs`, reached through the same methods here.

use crate::cache::{self, Cache};
use anyhow::Result;
use esp_idf_svc::nvs::{EspDefaultNvsPartition, EspNvs, NvsDefault};
use matecrew_cache::Error;
use matecrew_core::{contract::DeviceState, queue::Queue};

pub struct WifiCredentials {
    pub ssid: String,
    pub password: String,
}

/// What the setup page sends: the office Wi-Fi and the site to link to.
pub struct Setup {
    pub wifi: WifiCredentials,
    pub site: String,
}

pub struct Store(EspNvs<NvsDefault>, &'static Cache);

/// A cache that cannot keep a value is not the caller's failure: the value is still used, and
/// the next sync brings it again.
fn kept(result: Result<(), Error>) -> Result<()> {
    if let Err(e) = result {
        log::warn!("cache: {e}");
    }
    Ok(())
}

impl Store {
    pub fn new(partition: EspDefaultNvsPartition) -> Result<Self> {
        Ok(Self(EspNvs::new(partition, "matecrew", true)?, cache::open()?))
    }

    fn get(&self, key: &str) -> Result<Option<String>> {
        let mut buf = [0u8; 128];
        Ok(self.0.get_str(key, &mut buf)?.map(str::to_owned))
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        Ok(self.0.set_str(key, value)?)
    }

    fn get_blob(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let Some(len) = self.0.blob_len(key)? else {
            return Ok(None);
        };
        let mut buf = vec![0u8; len];
        Ok(self.0.get_blob(key, &mut buf)?.map(<[u8]>::to_vec))
    }

    pub fn app_mode(&self) -> Result<Option<matecrew_core::contract::BuiltinApp>> {
        Ok(match self.get("app_mode")?.as_deref() {
            Some("showcase") => Some(matecrew_core::contract::BuiltinApp::Showcase),
            Some("mate") => Some(matecrew_core::contract::BuiltinApp::Mate),
            _ => None,
        })
    }
    pub fn set_app_mode(&self, app: matecrew_core::contract::BuiltinApp) -> Result<()> {
        self.set(
            "app_mode",
            match app {
                matecrew_core::contract::BuiltinApp::Mate => "mate",
                matecrew_core::contract::BuiltinApp::Showcase => "showcase",
            },
        )
    }
    pub fn showcase_data(&self) -> Result<Option<serde_json::Value>> {
        Ok(self.1.get(&cache::SHOWCASE)?)
    }
    pub fn set_showcase_data(&self, data: &serde_json::Value) -> Result<()> {
        let mut data = data.clone();
        // The state is cached on its own; this keeps the showcase's navigation, theme and images.
        if let Some(object) = data.as_object_mut() {
            object.remove("showcase");
        }
        kept(self.1.put(&cache::SHOWCASE, &data))
    }
    pub fn wifi(&self) -> Result<Option<WifiCredentials>> {
        Ok(match (self.get("wifi_ssid")?, self.get("wifi_pass")?) {
            (Some(ssid), Some(password)) => Some(WifiCredentials { ssid, password }),
            _ => None,
        })
    }

    pub fn set_wifi(&self, creds: &WifiCredentials) -> Result<()> {
        self.set("wifi_ssid", &creds.ssid)?;
        self.set("wifi_pass", &creds.password)?;
        self.0.set_u8("wifi_fail", 0)?;
        Ok(())
    }

    pub fn clear_wifi(&self) -> Result<()> {
        self.0.remove("wifi_ssid")?;
        self.0.remove("wifi_pass")?;
        Ok(())
    }

    /// Counts failed Wi-Fi connections in a row; reset by a success.
    pub fn wifi_failures(&self) -> Result<u8> {
        Ok(self.0.get_u8("wifi_fail")?.unwrap_or(0))
    }

    pub fn set_wifi_failures(&self, count: u8) -> Result<()> {
        Ok(self.0.set_u8("wifi_fail", count)?)
    }

    /// The bearer token the site issued when the device was linked.
    /// The site the terminal links to and syncs with, chosen during setup.
    pub fn site(&self) -> Result<Option<String>> {
        self.get("site")
    }

    /// The same site at a new address (`site <url>` on the serial console): the token stays, and
    /// a site that does not know it answers 401, which links the terminal again.
    pub fn move_site(&self, site: &str) -> Result<()> {
        self.set("site", site)
    }

    /// A token is only good on the site that gave it: a new site forgets it.
    pub fn set_site(&self, site: &str) -> Result<()> {
        if self.site()?.as_deref() != Some(site) {
            self.clear_token()?;
        }
        self.set("site", site)
    }

    /// The firmware version installed and not confirmed yet (src/ota.rs).
    pub fn ota_pending(&self) -> Result<Option<String>> {
        self.get("ota_pending")
    }

    pub fn set_ota_pending(&self, version: Option<&str>) -> Result<()> {
        match version {
            Some(version) => self.set("ota_pending", version),
            None => Ok(self.0.remove("ota_pending").map(|_| ())?),
        }
    }

    /// A firmware version that failed: not tried again.
    pub fn ota_failed(&self) -> Result<Option<String>> {
        self.get("ota_failed")
    }

    pub fn set_ota_failed(&self, version: &str) -> Result<()> {
        self.set("ota_failed", version)
    }

    /// Terminals linked before the site was a setting have a token and no
    /// site: they keep the one they were built for, token included, so an
    /// update built for another default does not move them.
    pub fn pin_site(&self, built_for: &str) -> Result<()> {
        if self.site()?.is_none() && self.token()?.is_some() {
            self.set("site", built_for)?;
            log::info!("site {built_for} kept for this linked terminal");
        }
        Ok(())
    }

    pub fn token(&self) -> Result<Option<String>> {
        self.get("token")
    }

    pub fn set_token(&self, token: &str) -> Result<()> {
        self.set("token", token)
    }

    /// A link the site approved before the terminal asked (its device code, sent over Bluetooth
    /// with the Wi-Fi): the next link polls with it instead of showing a code.
    pub fn link_secret(&self) -> Result<Option<String>> {
        self.get("link_secret")
    }

    pub fn set_link_secret(&self, secret: Option<&str>) -> Result<()> {
        match secret {
            Some(secret) => self.set("link_secret", secret),
            None => {
                self.0.remove("link_secret")?;
                Ok(())
            }
        }
    }

    /// Forgets the token and everything that came with it, every cache included (another
    /// office's state and app): the device links again.
    pub fn clear_token(&self) -> Result<()> {
        for key in ["token", "queue"] {
            self.0.remove(key)?;
        }
        Ok(self.1.clear()?)
    }

    /// Badges, keys and items from the last sync, for badging while offline and for the first
    /// screen after a restart.
    pub fn state(&self) -> Result<Option<DeviceState>> {
        Ok(self.1.get(&cache::STATE)?)
    }

    pub fn set_state(&self, state: &DeviceState) -> Result<()> {
        kept(self.1.put(&cache::STATE, state))
    }

    /// Takes the site has not acknowledged yet, and badges it has not seen.
    pub fn queue(&self) -> Result<Queue> {
        Ok(self
            .get_blob("queue")?
            .map(|bytes| Queue::from_bytes(&bytes))
            .unwrap_or_default())
    }

    pub fn set_queue(&self, queue: &Queue) -> Result<()> {
        Ok(self.0.set_blob("queue", &queue.to_bytes())?)
    }

    /// The app's bytecode, if the one cached came from `url`.
    pub fn app(&self, url: &str) -> Result<Option<Vec<u8>>> {
        if self.1.get(&cache::APP_URL)?.as_deref() != Some(url) {
            return Ok(None);
        }
        Ok(self.1.get(&cache::APP)?)
    }
    pub fn set_app(&self, url: &str, bytes: &[u8]) -> Result<()> {
        // The address last: bytecode that is not kept leaves the old pair, which no state asks for.
        kept(self.1.put(&cache::APP, &bytes.to_vec()).and_then(|()| self.1.put(&cache::APP_URL, &url.to_owned())))
    }

    pub fn app_data(&self) -> Result<Option<serde_json::Value>> {
        Ok(self.1.get(&cache::APP_DATA)?)
    }
    pub fn set_app_data(&self, value: &serde_json::Value) -> Result<()> {
        kept(self.1.put(&cache::APP_DATA, value))
    }
}
