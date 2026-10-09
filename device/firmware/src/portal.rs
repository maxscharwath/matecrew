//! Captive portal of the setup access point: any page the phone opens shows
//! the Wi-Fi form, and DNS answers every name with the device's address.

use anyhow::Result;
use embedded_svc::http::{Headers, Method};
use embedded_svc::io::{Read, Write};
use esp_idf_svc::http::server::{Configuration, EspHttpServer};
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
        req.into_ok_response()?.write_all(page.as_bytes())?;
        if !creds.ssid.is_empty() {
            let _ = saved.send(creds);
        }
        Ok(())
    })?;

    server.fn_handler::<anyhow::Error, _>("/*", Method::Get, move |req| {
        req.into_response(200, None, &[("content-type", "text/html; charset=utf-8"), ("cache-control", "no-store")])?
            .write_all(page.as_bytes())?;
        Ok(())
    })?;

    Ok(server)
}

/// Answers every DNS question with an A record for `ip`. That makes phones
/// see a captive portal and open the setup page on their own.
fn answer_dns(ip: Ipv4Addr) -> Result<()> {
    let socket = UdpSocket::bind("0.0.0.0:53")?;
    let mut buf = [0u8; 512];
    loop {
        let (len, from) = socket.recv_from(&mut buf)?;
        if len < 12 {
            continue;
        }
        // Copy the question, then append one answer pointing at it.
        let mut reply = Vec::with_capacity(len + 16);
        reply.extend_from_slice(&buf[..2]); // id
        reply.extend_from_slice(&[0x81, 0x80]); // response, recursion available, no error
        reply.extend_from_slice(&buf[4..6]); // question count
        reply.extend_from_slice(&[0x00, 0x01, 0x00, 0x00, 0x00, 0x00]); // 1 answer
        reply.extend_from_slice(&buf[12..len]);
        reply.extend_from_slice(&[0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3C, 0x00, 0x04]);
        reply.extend_from_slice(&ip.octets());
        socket.send_to(&reply, from)?;
    }
}
