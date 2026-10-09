//! Parsing for the setup portal's form, kept here so it is tested on the Mac.

/// Decodes an `application/x-www-form-urlencoded` body into (name, value) pairs.
pub fn parse_urlencoded(body: &str) -> Vec<(String, String)> {
    body.split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(name), decode(value))
        })
        .collect()
}

pub fn field<'a>(fields: &'a [(String, String)], name: &str) -> Option<&'a str> {
    fields.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            byte => out.push(byte),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Escapes text for an HTML attribute or element body.
pub fn escape_html(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_spaces_percent_and_utf8() {
        let fields = parse_urlencoded("ssid=OWT+Office&password=p%40ss%3Dw%C3%B6rd&other=");
        assert_eq!(field(&fields, "ssid"), Some("OWT Office"));
        assert_eq!(field(&fields, "password"), Some("p@ss=wörd"));
        assert_eq!(field(&fields, "other"), Some(""));
        assert_eq!(field(&fields, "missing"), None);
    }

    #[test]
    fn keeps_a_stray_percent() {
        assert_eq!(field(&parse_urlencoded("a=100%"), "a"), Some("100%"));
        assert_eq!(field(&parse_urlencoded("a=%zz"), "a"), Some("%zz"));
    }

    #[test]
    fn escapes_html() {
        assert_eq!(escape_html(r#"<a href="x">&'"#), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    }
}

#[cfg(test)]
mod qr_tests {
    use crate::wifi_qr_payload;

    #[test]
    fn escapes_wifi_qr_fields() {
        assert_eq!(wifi_qr_payload("a;b", "p:w"), r"WIFI:T:WPA;S:a\;b;P:p\:w;;");
    }
}
