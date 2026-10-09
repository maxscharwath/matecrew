//! DNS answers of the setup access point, kept here so they are tested on the Mac.

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
        // Name pointer to the question, type A, class IN, TTL 60 s, 4 bytes.
        reply.extend_from_slice(&[0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3C, 0x00, 0x04]);
        reply.extend_from_slice(&ip.octets());
    }
    Some(reply)
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
    fn reads_the_question() {
        assert_eq!(question(&query(28)), Some(("captive.apple.com".to_owned(), 28)));
        assert_eq!(question(&[0; 5]), None);
    }
}
