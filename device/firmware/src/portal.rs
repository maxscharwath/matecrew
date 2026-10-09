//! Captive portal of the setup access point. DNS answers every name with the
//! device's address and every unknown page redirects to the form, which is
//! what makes iOS and Android open the settings page on their own.

use anyhow::Result;
use embedded_svc::http::{Headers, Method};
use embedded_svc::io::{Read, Write};
use esp_idf_svc::http::server::{Configuration, EspHttpServer};
use matecrew_ui::captive::dns_reply;
use matecrew_ui::form::{escape_html, field, parse_urlencoded};
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::mpsc::Sender;
use std::thread;

use crate::store::WifiCredentials;

const PAGE: &str = include_str!("portal.html");
const SAVED: &str = include_str!("portal-saved.html");

pub fn serve(ip: Ipv4Addr, networks: Vec<String>, saved: Sender<WifiCredentials>) -> Result<EspHttpServer<'static>> {
    thread::Builder::new()
        .name("dns".into())
        .stack_size(6 * 1024)
        .spawn(move || {
            if let Err(e) = answer_dns(ip) {
                log::error!("captive DNS stopped: {e}");
            }
        })?;

    let options: String = networks
        .iter()
        .map(|n| format!("<option value=\"{0}\">{0}</option>", escape_html(n)))
        .collect();
    let page = PAGE.replace("{{networks}}", &options);
    let home = format!("http://{ip}/");
    let host = ip.to_string();

    let mut server = EspHttpServer::new(&Configuration {
        uri_match_wildcard: true,
        stack_size: 10 * 1024,
        ..Default::default()
    })?;

    server.fn_handler::<anyhow::Error, _>("/save", Method::Post, move |mut req| {
        let len = (req.content_len().unwrap_or(0) as usize).min(1024);
        let mut body = vec![0u8; len];
        req.read_exact(&mut body)?;
        let fields = parse_urlencoded(&String::from_utf8_lossy(&body));
        let other = field(&fields, "other").unwrap_or("").trim();
        let ssid = if other.is_empty() { field(&fields, "ssid").unwrap_or("") } else { other };
        let password = field(&fields, "password").unwrap_or("");
        let creds = WifiCredentials { ssid: ssid.to_owned(), password: password.to_owned() };
        let page = SAVED.replace("{{ssid}}", &escape_html(&creds.ssid));
        req.into_response(200, None, &[("content-type", "text/html; charset=utf-8")])?
            .write_all(page.as_bytes())?;
        if !creds.ssid.is_empty() {
            let _ = saved.send(creds);
        }
        Ok(())
    })?;

    server.fn_handler::<anyhow::Error, _>("/*", Method::Get, move |req| {
        // Connectivity checks ask for other hosts (captive.apple.com,
        // connectivitycheck.gstatic.com...). Answering them with a redirect
        // tells the phone it is behind a portal, and it opens ours.
        let on_our_host = req.header("host").is_some_and(|h| h == host);
        let path = req.uri().split('?').next().unwrap_or("/");
        if !on_our_host || path != "/" {
            req.into_response(302, Some("Found"), &[("location", &home), ("cache-control", "no-store")])?;
            return Ok(());
        }
        req.into_response(200, None, &[("content-type", "text/html; charset=utf-8"), ("cache-control", "no-store")])?
            .write_all(page.as_bytes())?;
        Ok(())
    })?;

    Ok(server)
}

/// Answers A questions with `ip` and every other type with no record.
fn answer_dns(ip: Ipv4Addr) -> Result<()> {
    let socket = UdpSocket::bind("0.0.0.0:53")?;
    let mut buf = [0u8; 512];
    loop {
        let (len, from) = socket.recv_from(&mut buf)?;
        if let Some(reply) = dns_reply(&buf[..len], ip) {
            socket.send_to(&reply, from)?;
        }
    }
}
