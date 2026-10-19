//! Joining the office Wi-Fi, and the setup access point that asks for it.

use anyhow::{bail, Context, Result};
use esp_idf_svc::wifi::{
    AccessPointConfiguration, AccessPointInfo, AuthMethod, BlockingWifi, ClientConfiguration, Configuration, EspWifi,
};

use matecrew_core::networks::{Network, Networks};

pub type Wifi = BlockingWifi<EspWifi<'static>>;

/// An access point by its channel and BSSID: joined without scanning every channel first.
pub type AccessPoint = (u8, [u8; 6]);

/// Joins one of the networks kept, and says which. `known`: the access point joined before a
/// deep sleep, tried first with the network joined last (no scan, half a second sooner). Then a
/// scan: the networks kept that it hears, strongest first (`Networks::candidates`).
pub fn connect(wifi: &mut Wifi, networks: &Networks, known: Option<AccessPoint>) -> Result<String> {
    let last = networks.last().context("no network kept")?;
    if known.is_some() {
        configure(wifi, last, known)?;
        wifi.start()?;
        if join(wifi) {
            return Ok(last.ssid.clone());
        }
        log::warn!("wifi: the last access point did not answer, scanning");
        let _ = wifi.disconnect();
    }
    configure(wifi, last, None)?;
    wifi.start()?;
    let heard = match wifi.scan() {
        Ok(found) => found,
        Err(e) => {
            log::warn!("wifi: scan failed: {e:#}");
            Vec::new()
        }
    };
    let names: Vec<(String, i8)> = heard.iter().map(|ap| (ap.ssid.to_string(), ap.signal_strength)).collect();
    // A browser nearby offers them when it adds a network (`ble.rs`).
    crate::ble::set_networks(strongest_first(heard.clone()));
    for network in networks.candidates(&names) {
        // The strongest access point of the network, on its channel: no second scan.
        let ap = heard
            .iter()
            .filter(|ap| ap.ssid.as_str() == network.ssid)
            .max_by_key(|ap| ap.signal_strength)
            .map(|ap| (ap.channel, ap.bssid, ap.signal_strength));
        match ap {
            Some((channel, _, rssi)) => log::info!("wifi: joining {} on channel {channel} at {rssi} dBm", network.ssid),
            None => log::info!("wifi: joining {}, not heard (hidden?)", network.ssid),
        }
        configure(wifi, network, ap.map(|(channel, bssid, _)| (channel, bssid)))?;
        if join(wifi) {
            return Ok(network.ssid.clone());
        }
        log::warn!("wifi: {} did not let the terminal in", network.ssid);
        let _ = wifi.disconnect();
    }
    log::warn!("wifi: none of {} answers; {} networks heard", networks.names(), heard.len());
    bail!("none of the {} networks kept answers", networks.len())
}

fn join(wifi: &mut Wifi) -> bool {
    wifi.connect().and_then(|()| wifi.wait_netif_up()).is_ok()
}

/// Starts joining the network joined last without waiting: a key woke the terminal, which
/// answers it first. A later sync finds the network up (`reconnect`), or tries the others.
pub fn start_joining(wifi: &mut Wifi, networks: &Networks, known: Option<AccessPoint>) -> Result<String> {
    let last = networks.last().context("no network kept")?;
    configure(wifi, last, known)?;
    wifi.start()?;
    wifi.wifi_mut().connect()?;
    Ok(last.ssid.clone())
}

fn configure(wifi: &mut Wifi, network: &Network, known: Option<AccessPoint>) -> Result<()> {
    wifi.set_configuration(&Configuration::Client(ClientConfiguration {
        ssid: network.ssid.as_str().try_into().ok().context("SSID too long")?,
        password: network.password.as_str().try_into().ok().context("password too long")?,
        auth_method: if network.password.is_empty() { AuthMethod::None } else { AuthMethod::WPA2Personal },
        bssid: known.map(|(_, bssid)| bssid),
        channel: known.map(|(channel, _)| channel),
        ..Default::default()
    }))?;
    Ok(())
}

/// The access point joined, for the next wake.
pub fn access_point() -> Option<AccessPoint> {
    let mut info = esp_idf_svc::sys::wifi_ap_record_t::default();
    // SAFETY: plain query of the connected AP into a zeroed record.
    let ok = unsafe { esp_idf_svc::sys::esp_wifi_sta_get_ap_info(&mut info) } == 0;
    ok.then_some((info.primary, info.bssid))
}

/// The network joined, if the connection is up. Otherwise joins again without waiting: the
/// attempt goes on in the driver while the terminal answers its keys, and a later sync finds
/// the network up. Waiting held the keys for about 20 s at every try on a weak signal.
///
/// Each try goes to the next network kept: a terminal moved to another office, or whose
/// office network is down, finds the other one within a few tries.
pub fn reconnect(wifi: &mut Wifi, networks: &Networks) -> Result<String> {
    let Configuration::Client(client) = wifi.get_configuration()? else {
        bail!("Wi-Fi not in station mode");
    };
    let ssid = client.ssid.as_str().to_owned();
    if wifi.is_connected()? {
        if !wifi.is_up()? {
            bail!("Wi-Fi joined, waiting for an address");
        }
        return Ok(ssid);
    }
    // The access point of the last wake may be gone (`start_joining`): first any of the same
    // network's, then the next network.
    let next = if client.bssid.is_some() { networks.get(&ssid) } else { networks.after(&ssid) };
    let next = next.or(networks.last()).context("no network kept")?;
    log::info!("Wi-Fi lost, joining {} again in the background", next.ssid);
    crate::sleep::keep_access_point(None);
    // A connection still under way refuses a new configuration (ESP_ERR_WIFI_STATE).
    let _ = wifi.wifi_mut().disconnect();
    configure(wifi, next, None)?;
    if let Err(e) = wifi.wifi_mut().connect() {
        log::warn!("Wi-Fi: {e}");
    }
    bail!("Wi-Fi not joined yet")
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
    let networks = strongest_first(wifi.scan().unwrap_or_default());
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
    announce_dns(wifi, ip)?;
    Ok(SetupAccessPoint { ssid, password, ip: ip.to_string(), networks })
}

/// The names heard, strongest first, once each.
fn strongest_first(mut found: Vec<AccessPointInfo>) -> Vec<String> {
    found.sort_by_key(|ap| -i16::from(ap.signal_strength));
    let mut networks: Vec<String> = Vec::new();
    for ap in found {
        let name = ap.ssid.to_string();
        if !name.is_empty() && !networks.contains(&name) {
            networks.push(name);
        }
    }
    networks
}

/// Tells phones over DHCP to use the device as DNS server, so their
/// connectivity check lands on the portal.
///
/// No DHCP option 114 (RFC 8910): iOS reads it when it rejoins a network and
/// then expects the JSON Captive Portal API (RFC 8908) over HTTPS at that
/// address. An HTML page there kept the portal from opening.
fn announce_dns(wifi: &Wifi, ip: std::net::Ipv4Addr) -> Result<()> {
    use esp_idf_svc::handle::RawHandle;
    use esp_idf_svc::sys::*;
    let netif = wifi.wifi().ap_netif().handle();
    // OFFER_DNS from dhcpserver.h: announce our own address as DNS server.
    let mut offer_dns: u8 = 0x02;
    let mut dns = esp_netif_dns_info_t {
        ip: esp_ip_addr_t {
            u_addr: _ip_addr__bindgen_ty_1 { ip4: esp_ip4_addr_t { addr: u32::from_le_bytes(ip.octets()) } },
            type_: ESP_IPADDR_TYPE_V4 as u8,
        },
    };
    // SAFETY: valid netif handle; the option values are copied before the calls return.
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
