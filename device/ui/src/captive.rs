//! DNS answers and connectivity checks of the setup access point, kept here so they are tested
//! on the Mac.
//!
//! A phone that joins a network asks a known address and compares the answer with the one it
//! expects online. Anything else means a captive portal, and it opens the portal's page in its
//! login sheet: iOS asks captive.apple.com/hotspot-detect.html for "Success", Android a
//! `generate_204` page for an empty 204 (Google, and Samsung's, Xiaomi's and Huawei's own),
//! Windows `connecttest.txt`, Firefox detectportal.firefox.com. Before the Wi-Fi is set, every
//! check gets a redirect to the form; once it is, the answer it expects online, so the sheet
//! shows "Done" and closes. No DHCP option 114 (RFC 8910): it points iOS at a JSON API that
//! must be served over HTTPS, which a local address cannot be.

use std::net::Ipv4Addr;

/// Reply to a DNS query: an A record pointing at `ip` for A questions, no
/// record for any other type (AAAA, HTTPS...). None for what is not a query.
pub fn dns_reply(query: &[u8], ip: Ipv4Addr) -> Option<Vec<u8>> {
    if query.len() < 12 || query[2] & 0x80 != 0 {
        return None;
    }
    // The question ends after the name's labels and 4 bytes of type and
    // class. What follows (an EDNS record) must not be echoed.
    let mut end = 12;
    loop {
        let label = *query.get(end)? as usize;
        end += 1;
        if label == 0 {
            break;
        }
        if label & 0xC0 != 0 {
            return None;
        }
        end += label;
    }
    let qtype = u16::from_be_bytes([*query.get(end)?, *query.get(end + 1)?]);
    end += 4;
    if end > query.len() {
        return None;
    }
    let answers: u8 = u8::from(qtype == 1);

    let mut reply = Vec::with_capacity(end + 16);
    reply.extend_from_slice(&query[..2]); // id
    reply.extend_from_slice(&[0x81, 0x80]); // response, recursion available, no error
    reply.extend_from_slice(&[0x00, 0x01, 0x00, answers, 0x00, 0x00, 0x00, 0x00]);
    reply.extend_from_slice(&query[12..end]);
    if answers == 1 {
        // Name pointer to the question, type A, class IN, TTL 10 s, 4 bytes: a phone forgets
        // the access point's answers soon after it leaves.
        reply.extend_from_slice(&[0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x04]);
        reply.extend_from_slice(&ip.octets());
    }
    Some(reply)
}

/// Who sends a connectivity check.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Probe {
    Apple,
    Android,
    Windows,
    Firefox,
}

const APPLE_HOSTS: [&str; 7] = [
    "captive.apple.com",
    "www.apple.com",
    "www.appleiphonecell.com",
    "www.ibook.com",
    "www.itools.info",
    "www.airport.us",
    "www.thinkdifferent.us",
];

/// The connectivity check a request is, if it is one.
pub fn probe(host: &str, path: &str) -> Option<Probe> {
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    let path = path.split('?').next().unwrap_or(path).to_ascii_lowercase();
    if APPLE_HOSTS.contains(&host.as_str()) || path.ends_with("/hotspot-detect.html") {
        Some(Probe::Apple)
    } else if path.ends_with("/generate_204") || path.ends_with("/gen_204") {
        Some(Probe::Android)
    } else if host.ends_with("msftconnecttest.com") || host.ends_with("msftncsi.com") {
        Some(Probe::Windows)
    } else if host == "detectportal.firefox.com" {
        Some(Probe::Firefox)
    } else {
        None
    }
}

/// What a connectivity check expects when the network reaches the internet: status, content
/// type and body.
pub fn online(probe: Probe, path: &str) -> (u16, &'static str, &'static str) {
    match probe {
        Probe::Apple => (200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"),
        Probe::Android => (204, "text/plain", ""),
        Probe::Windows if path.ends_with("ncsi.txt") => (200, "text/plain", "Microsoft NCSI"),
        Probe::Windows => (200, "text/plain", "Microsoft Connect Test"),
        Probe::Firefox if path.ends_with("success.txt") => (200, "text/plain", "success\n"),
        Probe::Firefox => (
            200,
            "text/html",
            "<meta http-equiv=\"refresh\" content=\"0;url=https://support.mozilla.org/kb/captive-portal\"/>",
        ),
    }
}

/// The name and type a DNS query asks for, for the log: ("captive.apple.com", 1).
pub fn question(query: &[u8]) -> Option<(String, u16)> {
    let mut name = String::new();
    let mut at = 12;
    loop {
        let label = *query.get(at)? as usize;
        at += 1;
        if label == 0 {
            break;
        }
        if label & 0xC0 != 0 {
            return None;
        }
        if !name.is_empty() {
            name.push('.');
        }
        name.push_str(&String::from_utf8_lossy(query.get(at..at + label)?));
        at += label;
    }
    Some((name, u16::from_be_bytes([*query.get(at)?, *query.get(at + 1)?])))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Query for captive.apple.com, with an EDNS OPT record like iOS sends.
    fn query(qtype: u8) -> Vec<u8> {
        let mut q = vec![0xAB, 0xCD, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
        for label in ["captive", "apple", "com"] {
            q.push(label.len() as u8);
            q.extend_from_slice(label.as_bytes());
        }
        q.extend_from_slice(&[0x00, 0x00, qtype, 0x00, 0x01]);
        q.extend_from_slice(&[0x00, 0x00, 0x29, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        q
    }

    #[test]
    fn answers_a_with_our_address_and_drops_edns() {
        let ip = Ipv4Addr::new(192, 168, 71, 1);
        let reply = dns_reply(&query(1), ip).unwrap();
        assert_eq!(&reply[..2], &[0xAB, 0xCD]);
        assert_eq!(&reply[4..12], &[0, 1, 0, 1, 0, 0, 0, 0]);
        let question_end = 12 + 1 + 7 + 1 + 5 + 1 + 3 + 1 + 4;
        assert_eq!(reply.len(), question_end + 16);
        assert_eq!(&reply[reply.len() - 4..], &[192, 168, 71, 1]);
    }

    #[test]
    fn answers_aaaa_with_no_record() {
        let reply = dns_reply(&query(28), Ipv4Addr::new(192, 168, 71, 1)).unwrap();
        assert_eq!(&reply[6..8], &[0, 0]);
    }

    #[test]
    fn ignores_responses_and_garbage() {
        let mut response = query(1);
        response[2] |= 0x80;
        assert!(dns_reply(&response, Ipv4Addr::LOCALHOST).is_none());
        assert!(dns_reply(&[1, 2, 3], Ipv4Addr::LOCALHOST).is_none());
    }

    #[test]
    fn knows_each_platforms_connectivity_check() {
        assert_eq!(probe("captive.apple.com", "/hotspot-detect.html"), Some(Probe::Apple));
        assert_eq!(probe("www.apple.com", "/library/test/success.html"), Some(Probe::Apple));
        assert_eq!(probe("connectivitycheck.gstatic.com", "/generate_204"), Some(Probe::Android));
        assert_eq!(probe("connect.rom.miui.com", "/generate_204?x=1"), Some(Probe::Android));
        assert_eq!(probe("www.google.com", "/gen_204"), Some(Probe::Android));
        assert_eq!(probe("www.msftconnecttest.com", "/connecttest.txt"), Some(Probe::Windows));
        assert_eq!(probe("detectportal.firefox.com:80", "/canonical.html"), Some(Probe::Firefox));
        assert_eq!(probe("192.168.71.1", "/"), None);
        assert_eq!(probe("example.com", "/favicon.ico"), None);
    }

    #[test]
    fn answers_a_check_as_the_internet_would() {
        assert_eq!(online(Probe::Android, "/generate_204").0, 204);
        assert!(online(Probe::Apple, "/hotspot-detect.html").2.contains("<BODY>Success</BODY>"));
        assert_eq!(online(Probe::Windows, "/ncsi.txt").2, "Microsoft NCSI");
    }

    #[test]
    fn reads_the_question() {
        assert_eq!(question(&query(28)), Some(("captive.apple.com".to_owned(), 28)));
        assert_eq!(question(&[0; 5]), None);
    }
}
