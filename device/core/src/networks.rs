//! The Wi-Fi networks the terminal knows, most recently joined first: the office's, a second
//! office's, a phone's hotspot. Setting up a network adds it and keeps the others; joining one
//! moves it first, so the next wake tries it before any other. Kept as JSON in NVS
//! (`firmware/src/store.rs`).

use serde::{Deserialize, Serialize};

/// Networks kept at most: the one joined longest ago goes when a new one comes.
pub const MAX: usize = 5;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Network {
    pub ssid: String,
    #[serde(default)]
    pub password: String,
}

impl Network {
    /// A network without a password.
    pub fn open(ssid: &str) -> Self {
        Self { ssid: ssid.to_owned(), password: String::new() }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
pub struct Networks(Vec<Network>);

impl Networks {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        serde_json::from_slice(bytes).unwrap_or_default()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Network> {
        self.0.iter()
    }

    /// The network joined last: tried first, without a scan.
    pub fn last(&self) -> Option<&Network> {
        self.0.first()
    }

    pub fn get(&self, ssid: &str) -> Option<&Network> {
        self.0.iter().find(|n| n.ssid == ssid)
    }

    /// Adds a network first, or updates its password; the oldest goes past [`MAX`].
    pub fn remember(&mut self, network: Network) {
        self.0.retain(|n| n.ssid != network.ssid);
        self.0.insert(0, network);
        self.0.truncate(MAX);
    }

    /// Moves a network joined first; false when it already was (nothing to save).
    pub fn joined(&mut self, ssid: &str) -> bool {
        match self.0.iter().position(|n| n.ssid == ssid) {
            Some(0) | None => false,
            Some(at) => {
                let network = self.0.remove(at);
                self.0.insert(0, network);
                true
            }
        }
    }

    /// Forgets a network; false when it was not known.
    pub fn forget(&mut self, ssid: &str) -> bool {
        let before = self.0.len();
        self.0.retain(|n| n.ssid != ssid);
        self.0.len() != before
    }

    /// What to try, given what a scan heard (SSID, signal in dBm): the known networks heard,
    /// strongest first. None heard: the one joined last, which may hide its name (a hidden
    /// network answers only when asked by name).
    pub fn candidates(&self, heard: &[(String, i8)]) -> Vec<&Network> {
        let mut found: Vec<(&Network, i8)> = self
            .0
            .iter()
            .filter_map(|n| heard.iter().filter(|(ssid, _)| *ssid == n.ssid).map(|(_, rssi)| (n, *rssi)).max_by_key(|(_, rssi)| *rssi))
            .collect();
        if found.is_empty() {
            return self.last().into_iter().collect();
        }
        // Stable: two networks as strong keep the order they were joined in.
        found.sort_by_key(|(_, rssi)| -i16::from(*rssi));
        found.into_iter().map(|(n, _)| n).collect()
    }

    /// The network after `ssid`, in turn: what to try next while none answers.
    pub fn after(&self, ssid: &str) -> Option<&Network> {
        let at = self.0.iter().position(|n| n.ssid == ssid).map_or(0, |at| at + 1);
        self.0.get(at % self.0.len().max(1))
    }

    /// The names, comma-separated: for the setup screen and the log.
    pub fn names(&self) -> String {
        self.0.iter().map(|n| n.ssid.as_str()).collect::<Vec<_>>().join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn net(ssid: &str) -> Network {
        Network::open(ssid)
    }

    fn known(ssids: &[&str]) -> Networks {
        let mut networks = Networks::default();
        for ssid in ssids.iter().rev() {
            networks.remember(net(ssid));
        }
        networks
    }

    fn ssids(list: Vec<&Network>) -> Vec<&str> {
        list.into_iter().map(|n| n.ssid.as_str()).collect()
    }

    #[test]
    fn remembers_the_newest_first_and_keeps_five() {
        let mut networks = known(&["A", "B"]);
        let mut changed = net("B");
        changed.password.push('!');
        networks.remember(changed.clone());
        assert_eq!(networks.names(), "B, A");
        assert_eq!(networks.get("B"), Some(&changed));
        for ssid in ["C", "D", "E", "F"] {
            networks.remember(net(ssid));
        }
        assert_eq!(networks.names(), "F, E, D, C, B");
    }

    #[test]
    fn moves_the_network_joined_first() {
        let mut networks = known(&["A", "B", "C"]);
        assert!(networks.joined("C"));
        assert_eq!(networks.names(), "C, A, B");
        assert!(!networks.joined("C"), "already first: nothing to save");
        assert!(!networks.joined("Z"));
    }

    #[test]
    fn tries_the_networks_heard_strongest_first() {
        let networks = known(&["Office", "Home", "Hotspot"]);
        let heard = [("Cafe".into(), -40), ("Hotspot".into(), -50), ("Office".into(), -80), ("Office".into(), -60)];
        assert_eq!(ssids(networks.candidates(&heard)), ["Hotspot", "Office"]);
        assert_eq!(ssids(networks.candidates(&[])), ["Office"], "none heard: the last, maybe hidden");
        assert!(Networks::default().candidates(&heard).is_empty());
    }

    #[test]
    fn turns_through_the_networks() {
        let networks = known(&["A", "B", "C"]);
        assert_eq!(networks.after("A").unwrap().ssid, "B");
        assert_eq!(networks.after("C").unwrap().ssid, "A");
        assert_eq!(networks.after("gone").unwrap().ssid, "A");
        assert!(Networks::default().after("A").is_none());
    }

    #[test]
    fn forgets_one() {
        let mut networks = known(&["A", "B"]);
        assert!(networks.forget("A"));
        assert!(!networks.forget("A"));
        assert_eq!(networks.names(), "B");
    }

    #[test]
    fn round_trips_and_survives_garbage() {
        let networks = known(&["Office", "Open"]);
        assert_eq!(Networks::from_bytes(&networks.to_bytes()), networks);
        assert!(Networks::from_bytes(b"nope").is_empty());
        assert_eq!(Networks::from_bytes(br#"[{"ssid":"Open"}]"#).last(), Some(&Network::open("Open")));
    }
}
