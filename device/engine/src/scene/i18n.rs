//! Translated text: messages per locale, chosen when drawing. The app's `local.locale` wins,
//! then the host's `$device.locale`, then the app's default. Messages use a small ICU subset:
//! `{name}`, `{n, plural, =0 {...} one {...} other {...}}` (with `#`), `{x, select, a {...} other {...}}`.
use super::expr::text;
use serde_json::Value;

const MAX_OUTPUT: usize = 512;
const MAX_NESTING: usize = 4;

/// The locale to use: app choice, host locale, else the first (default) of `available`.
pub fn locale<'a>(data: &Value, available: impl Iterator<Item = &'a str> + Clone) -> Option<&'a str> {
    let wanted = [data["local"]["locale"].as_str(), data["$device"]["locale"].as_str()];
    for want in wanted.into_iter().flatten().filter(|w| !w.is_empty()) {
        let language = want.split(['-', '_']).next().unwrap_or(want);
        if let Some(found) = available.clone().find(|l| l.eq_ignore_ascii_case(want)) {
            return Some(found);
        }
        if let Some(found) = available.clone().find(|l| l.split(['-', '_']).next().unwrap_or(l).eq_ignore_ascii_case(language)) {
            return Some(found);
        }
    }
    available.clone().next()
}

/// CLDR plural category for `n` in `locale` (the languages the terminal ships).
fn plural(locale: &str, n: f64) -> &'static str {
    let language = locale.split(['-', '_']).next().unwrap_or(locale);
    match language {
        // French and Portuguese: 0 and 1 (and everything below 2) are singular.
        "fr" | "pt" => if (0.0..2.0).contains(&n.abs()) { "one" } else { "other" },
        _ => if n == 1.0 { "one" } else { "other" },
    }
}

/// `message` with its arguments filled in.
pub fn format(message: &str, params: &[(String, Value)], locale: &str) -> String {
    let mut out = String::new();
    write(message, params, locale, None, 0, &mut out);
    out.chars().take(MAX_OUTPUT).collect()
}

fn param<'a>(params: &'a [(String, Value)], name: &str) -> Option<&'a Value> {
    params.iter().find(|(n, _)| n == name).map(|(_, v)| v)
}

fn write(message: &str, params: &[(String, Value)], locale: &str, count: Option<&Value>, depth: usize, out: &mut String) {
    let chars: Vec<char> = message.chars().collect();
    let mut i = 0;
    while i < chars.len() && out.len() < MAX_OUTPUT * 4 {
        match chars[i] {
            '#' if count.is_some() => {
                out.push_str(&text(count.unwrap()));
                i += 1;
            }
            '{' => {
                let Some(end) = closing(&chars, i) else {
                    out.extend(&chars[i..]);
                    return;
                };
                let inner: String = chars[i + 1..end].iter().collect();
                argument(&inner, params, locale, depth, out);
                i = end + 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
}

/// Index of the `}` closing the `{` at `open`, braces nested.
fn closing(chars: &[char], open: usize) -> Option<usize> {
    let mut depth = 0;
    for (i, c) in chars.iter().enumerate().skip(open) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn argument(inner: &str, params: &[(String, Value)], locale: &str, depth: usize, out: &mut String) {
    let mut parts = inner.splitn(3, ',');
    let name = parts.next().unwrap_or("").trim();
    let value = param(params, name).cloned().unwrap_or(Value::Null);
    let Some(kind) = parts.next().map(str::trim) else {
        out.push_str(&text(&value));
        return;
    };
    if depth >= MAX_NESTING {
        return;
    }
    let options = options(parts.next().unwrap_or(""));
    let chosen = match kind {
        "plural" => {
            let n = value.as_f64().or_else(|| value.as_str().and_then(|s| s.trim().parse().ok())).unwrap_or(0.0);
            options
                .iter()
                .find(|(key, _)| key.strip_prefix('=').and_then(|k| k.parse::<f64>().ok()) == Some(n))
                .or_else(|| options.iter().find(|(key, _)| key == plural(locale, n)))
                .or_else(|| options.iter().find(|(key, _)| key == "other"))
        }
        "select" => {
            let selected = text(&value);
            options.iter().find(|(key, _)| *key == selected).or_else(|| options.iter().find(|(key, _)| key == "other"))
        }
        _ => None,
    };
    if let Some((_, body)) = chosen {
        let count = (kind == "plural").then_some(&value);
        write(body, params, locale, count, depth + 1, out);
    }
}

/// `key {body} key {body}` pairs of a plural or select argument.
fn options(source: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = source.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '{' {
            i += 1;
        }
        let key: String = chars[start..i].iter().collect();
        while i < chars.len() && chars[i] != '{' {
            i += 1;
        }
        let Some(end) = (i < chars.len()).then(|| closing(&chars, i)).flatten() else { break };
        out.push((key, chars[i + 1..end].iter().collect()));
        i = end + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn p(pairs: &[(&str, Value)]) -> Vec<(String, Value)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }
    #[test]
    fn messages_fill_arguments_plurals_and_selects_per_locale() {
        let plural = "{count, plural, =0 {Plus rien} one {# maté} other {# matés}}";
        assert_eq!(format(plural, &p(&[("count", json!(0))]), "fr"), "Plus rien");
        assert_eq!(format(plural, &p(&[("count", json!(1))]), "fr"), "1 maté");
        assert_eq!(format(plural, &p(&[("count", json!(36))]), "fr"), "36 matés");
        let english = "{count, plural, one {# can} other {# cans}} left";
        assert_eq!(format(english, &p(&[("count", json!(0))]), "en"), "0 cans left");
        assert_eq!(format(english, &p(&[("count", json!(1))]), "en-GB"), "1 can left");
        assert_eq!(format("Bonne pause {name} !", &p(&[("name", json!("Alex"))]), "fr"), "Bonne pause Alex !");
        assert_eq!(format("{side, select, left {Gauche} other {Droite}}", &p(&[("side", json!("left"))]), "fr"), "Gauche");
        assert_eq!(format("Inconnu {missing}.", &[], "fr"), "Inconnu .");
        assert_eq!(format("Ouvert {", &[], "fr"), "Ouvert {");
        let data = json!({"local":{"locale":""},"$device":{"locale":"en-US"}});
        assert_eq!(locale(&data, ["fr", "en"].into_iter()), Some("en"));
        assert_eq!(locale(&json!({"local":{"locale":"de"}}), ["fr", "en"].into_iter()), Some("fr"));
    }
}
