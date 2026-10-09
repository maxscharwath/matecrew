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
    let ip = wifi.wifi().ap_netif().get_ip_info()?.ip;
    announce_captive_portal(wifi, ip)?;
    Ok(SetupAccessPoint { ssid, password, ip: ip.to_string(), networks })
}

/// Tells phones over DHCP to use the device as DNS server and where the
/// portal is (option 114, RFC 8910), so recent iOS and Android open it
/// without waiting for their connectivity check.
fn announce_captive_portal(wifi: &Wifi, ip: std::net::Ipv4Addr) -> Result<()> {
    use esp_idf_svc::handle::RawHandle;
    use esp_idf_svc::sys::*;
    let netif = wifi.wifi().ap_netif().handle();
    // The DHCP server keeps the pointer for its whole life: leak it on purpose.
    let uri: &'static std::ffi::CStr =
        Box::leak(std::ffi::CString::new(format!("http://{ip}"))?.into_boxed_c_str());
    // OFFER_DNS from dhcpserver.h: announce our own address as DNS server.
    let mut offer_dns: u8 = 0x02;
    let mut dns = esp_netif_dns_info_t {
        ip: esp_ip_addr_t {
            u_addr: _ip_addr__bindgen_ty_1 { ip4: esp_ip4_addr_t { addr: u32::from_le_bytes(ip.octets()) } },
            type_: ESP_IPADDR_TYPE_V4 as u8,
        },
    };
    // SAFETY: valid netif handle; the option values live long enough (the URI forever).
    unsafe {
        esp_netif_dhcps_stop(netif);
        esp!(esp_netif_dhcps_option(
            netif,
            esp_netif_dhcp_option_mode_t_ESP_NETIF_OP_SET,
            esp_netif_dhcp_option_id_t_ESP_NETIF_DOMAIN_NAME_SERVER,
            (&mut offer_dns as *mut u8).cast(),
            1,
        ))?;
        esp!(esp_netif_set_dns_info(netif, esp_netif_dns_type_t_ESP_NETIF_DNS_MAIN, &mut dns))?;
        esp!(esp_netif_dhcps_option(
            netif,
            esp_netif_dhcp_option_mode_t_ESP_NETIF_OP_SET,
            esp_netif_dhcp_option_id_t_ESP_NETIF_CAPTIVEPORTAL_URI,
            uri.as_ptr() as *mut core::ffi::c_void,
            uri.to_bytes().len() as u32,
        ))?;
        esp!(esp_netif_dhcps_start(netif))?;
    }
    Ok(())
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
