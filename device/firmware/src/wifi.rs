//! Joining the office Wi-Fi, and the setup access point that asks for it.

use anyhow::{Context, Result};
use esp_idf_svc::wifi::{
    AccessPointConfiguration, AuthMethod, BlockingWifi, ClientConfiguration, Configuration, EspWifi,
};

use crate::store::WifiCredentials;

pub type Wifi = BlockingWifi<EspWifi<'static>>;

pub fn connect(wifi: &mut Wifi, creds: &WifiCredentials) -> Result<()> {
    wifi.set_configuration(&Configuration::Client(ClientConfiguration {
        ssid: creds.ssid.as_str().try_into().ok().context("SSID too long")?,
        password: creds.password.as_str().try_into().ok().context("password too long")?,
        auth_method: if creds.password.is_empty() { AuthMethod::None } else { AuthMethod::WPA2Personal },
        ..Default::default()
    }))?;
    wifi.start()?;
    wifi.connect()?;
    wifi.wait_netif_up()?;
    Ok(())
}

/// Wi-Fi MAC as "AC:A7:04:2B:50:E4": the hardware id shown on the link page.
pub fn hardware_id(wifi: &Wifi) -> Result<String> {
    let mac = wifi.wifi().sta_netif().get_mac()?;
    Ok(mac.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":"))
}

pub fn rssi() -> Option<i8> {
    let mut info = esp_idf_svc::sys::wifi_ap_record_t::default();
    // SAFETY: plain query of the connected AP into a zeroed record.
    let ok = unsafe { esp_idf_svc::sys::esp_wifi_sta_get_ap_info(&mut info) } == 0;
    ok.then_some(info.rssi)
}

pub struct SetupAccessPoint {
    pub ssid: String,
    pub password: String,
    pub ip: String,
    /// Networks seen before the access point started, strongest first.
    pub networks: Vec<String>,
}

/// Scans, then opens a WPA2 access point with a random password. The password
/// goes in the QR, so only the phone that scans it joins.
pub fn start_setup_access_point(wifi: &mut Wifi) -> Result<SetupAccessPoint> {
    let mac = wifi.wifi().sta_netif().get_mac()?;
    let ssid = format!("matecrew-setup-{:02X}{:02X}", mac[4], mac[5]);
    let password = random_password();

    wifi.set_configuration(&Configuration::Client(ClientConfiguration::default()))?;
    wifi.start()?;
    let mut found = wifi.scan().unwrap_or_default();
    found.sort_by_key(|ap| -i16::from(ap.signal_strength));
    let mut networks: Vec<String> = Vec::new();
    for ap in found {
        let name = ap.ssid.to_string();
        if !name.is_empty() && !networks.contains(&name) {
            networks.push(name);
        }
    }
    wifi.stop()?;

    wifi.set_configuration(&Configuration::AccessPoint(AccessPointConfiguration {
        ssid: ssid.as_str().try_into().ok().context("SSID too long")?,
        password: password.as_str().try_into().ok().context("password too long")?,
        auth_method: AuthMethod::WPA2Personal,
        channel: 6,
        max_connections: 2,
        ..Default::default()
    }))?;
    wifi.start()?;
    wifi.wait_netif_up()?;
    let ip = wifi.wifi().ap_netif().get_ip_info()?.ip.to_string();
    Ok(SetupAccessPoint { ssid, password, ip, networks })
}

fn random_password() -> String {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    (0..10)
        .map(|_| {
            // SAFETY: esp_random reads the hardware RNG, seeded by the radio once Wi-Fi is on.
            let n = unsafe { esp_idf_svc::sys::esp_random() } as usize;
            ALPHABET[n % ALPHABET.len()] as char
        })
        .collect()
}
