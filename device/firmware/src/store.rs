//! Settings kept in NVS across reboots and deep sleep.

use anyhow::Result;
use esp_idf_svc::nvs::{EspDefaultNvsPartition, EspNvs, NvsDefault};
use matecrew_core::{contract::DeviceState, queue::Queue};

pub struct WifiCredentials {
    pub ssid: String,
    pub password: String,
}

pub struct Store(EspNvs<NvsDefault>);

impl Store {
    pub fn new(partition: EspDefaultNvsPartition) -> Result<Self> {
        Ok(Self(EspNvs::new(partition, "matecrew", true)?))
    }

    fn get(&self, key: &str) -> Result<Option<String>> {
        let mut buf = [0u8; 128];
        Ok(self.0.get_str(key, &mut buf)?.map(str::to_owned))
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        Ok(self.0.set_str(key, value)?)
    }

    fn get_blob(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let Some(len) = self.0.blob_len(key)? else { return Ok(None) };
        let mut buf = vec![0u8; len];
        Ok(self.0.get_blob(key, &mut buf)?.map(<[u8]>::to_vec))
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
    pub fn token(&self) -> Result<Option<String>> {
        self.get("token")
    }

    pub fn set_token(&self, token: &str) -> Result<()> {
        self.set("token", token)
    }

    /// Forgets the token and everything that came with it: the device links again.
    pub fn clear_token(&self) -> Result<()> {
        for key in ["token", "etag", "state", "queue"] {
            self.0.remove(key)?;
        }
        Ok(())
    }

    /// Badges, keys and items from the last sync, for badging while offline.
    pub fn state(&self) -> Result<Option<DeviceState>> {
        Ok(self.get_blob("state")?.and_then(|bytes| serde_json::from_slice(&bytes).ok()))
    }

    pub fn set_state(&self, state: &DeviceState) -> Result<()> {
        Ok(self.0.set_blob("state", &serde_json::to_vec(state)?)?)
    }

    /// Takes the site has not acknowledged yet, and badges it has not seen.
    pub fn queue(&self) -> Result<Queue> {
        Ok(self.get_blob("queue")?.map(|bytes| Queue::from_bytes(&bytes)).unwrap_or_default())
    }

    pub fn set_queue(&self, queue: &Queue) -> Result<()> {
        Ok(self.0.set_blob("queue", &queue.to_bytes())?)
    }

    /// ETag of the screen bitmap on the panel, so an unchanged screen is not redrawn.
    pub fn screen_etag(&self) -> Result<Option<String>> {
        self.get("etag")
    }

    pub fn set_screen_etag(&self, etag: &str) -> Result<()> {
        self.set("etag", etag)
    }
}
