//! Captive portal of the setup access point. DNS answers every name with the
//! device's address and every unknown page redirects to the form: the phone's
//! connectivity check (captive.apple.com, connectivitycheck.gstatic.com...)
//! gets a redirect instead of its expected answer, so iOS and Android open the
//! settings page on their own (`matecrew_ui::captive`). Once the Wi-Fi is
//! saved, the checks get their online answer and the phone's login sheet can
//! close. Every DNS question and page is logged, to see on the serial monitor
//! what a phone tried.

use anyhow::Result;
use embedded_svc::http::{Headers, Method};
use embedded_svc::io::{Read, Write};
use esp_idf_svc::http::server::{Configuration, EspHttpServer};
use matecrew_ui::captive::{dns_reply, online, probe, question};
use matecrew_ui::form::{escape_html, field, parse_urlencoded};
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::Sender,
    Arc,
};
use std::thread;

use crate::api::normalize_site;
use crate::store::Setup;
use matecrew_core::networks::Network;

const PAGE: &str = include_str!("portal.html");
const SAVED: &str = include_str!("portal-saved.html");

/// The portal while it runs: dropped, its page and its DNS stop (a linked terminal goes on
/// without a new network).
pub struct Portal {
    _server: EspHttpServer<'static>,
    stop: Arc<AtomicBool>,
}

impl Drop for Portal {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

pub fn serve(ip: Ipv4Addr, networks: Vec<String>, site: String, saved: Sender<Setup>) -> Result<Portal> {
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    thread::Builder::new()
        .name("dns".into())
        .stack_size(6 * 1024)
        .spawn(move || {
            if let Err(e) = answer_dns(ip, &stopped) {
                log::error!("captive DNS stopped: {e}");
            }
        })?;

    let options: String = networks
        .iter()
        .map(|n| format!("<option value=\"{0}\">{0}</option>", escape_html(n)))
        .collect();
    let page = PAGE.replace("{{networks}}", &options).replace("{{site}}", &escape_html(&site));
    let home = format!("http://{ip}/");
    let host = ip.to_string();
    // Set once the form is sent: the checks then get their online answer.
    let done = Arc::new(AtomicBool::new(false));
    let saving = done.clone();

    let mut server = EspHttpServer::new(&Configuration {
        uri_match_wildcard: true,
        stack_size: 10 * 1024,
        // A phone opens many connections at once when it joins. lwIP has 10
        // sockets and the server keeps 3 for itself; the oldest is dropped
        // when they run out.
        max_open_sockets: 7,
        lru_purge_enable: true,
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
        let creds = Network { ssid: ssid.to_owned(), password: password.to_owned() };
        // A site that is not a web address keeps the one proposed.
        let chosen = field(&fields, "site").and_then(normalize_site).unwrap_or_else(|| site.clone());
        let page = SAVED
            .replace("{{ssid}}", &escape_html(&creds.ssid))
            .replace("{{site}}", &escape_html(crate::api::host(&chosen)));
        req.into_response(200, None, &[("content-type", "text/html; charset=utf-8")])?
            .write_all(page.as_bytes())?;
        if !creds.ssid.is_empty() {
            saving.store(true, Ordering::Relaxed);
            let _ = saved.send(Setup { wifi: creds, site: chosen });
        }
        Ok(())
    })?;

    // A redirect with a body and a closed connection: some checks want both.
    let moved = format!("<html><body><a href=\"{home}\">matécrew</a></body></html>");
    for method in [Method::Get, Method::Head] {
        let (page, home, host, moved, done) = (page.clone(), home.clone(), host.clone(), moved.clone(), done.clone());
        server.fn_handler::<anyhow::Error, _>("/*", method, move |req| {
            let head = method == Method::Head;
            let asked = req.header("host").unwrap_or("").to_owned();
            let path = req.uri().split('?').next().unwrap_or("/").to_owned();
            let check = probe(&asked, &path);
            if let (Some(check), true) = (check, done.load(Ordering::Relaxed)) {
                // Wi-Fi saved: the answer the check expects online, so the login sheet closes.
                let (status, kind, body) = online(check, &path);
                log::info!("portal: {check:?} check http://{asked}{path} → {status} (online)");
                let mut reply = req.into_response(status, None, &[("content-type", kind), ("cache-control", "no-store"), ("connection", "close")])?;
                if !head {
                    reply.write_all(body.as_bytes())?;
                }
                return Ok(());
            }
            if asked != host || path != "/" {
                // A connectivity check, or any other page: the redirect tells the phone it is
                // behind a portal, and it opens ours.
                match check {
                    Some(check) => log::info!("portal: {check:?} check http://{asked}{path} → 302 {home}"),
                    None => log::info!("portal: http://{asked}{path} → 302 {home}"),
                }
                let mut reply = req.into_response(
                    302,
                    Some("Found"),
                    &[("location", &home), ("content-type", "text/html"), ("cache-control", "no-store"), ("connection", "close")],
                )?;
                if !head {
                    reply.write_all(moved.as_bytes())?;
                }
                return Ok(());
            }
            log::info!("portal: page served");
            let mut reply = req.into_response(200, None, &[("content-type", "text/html; charset=utf-8"), ("cache-control", "no-store")])?;
            if !head {
                reply.write_all(page.as_bytes())?;
            }
            Ok(())
        })?;
    }

    Ok(Portal { _server: server, stop })
}

/// Answers A questions with `ip` and every other type with no record, until `stop`.
fn answer_dns(ip: Ipv4Addr, stop: &AtomicBool) -> Result<()> {
    let socket = UdpSocket::bind("0.0.0.0:53")?;
    socket.set_read_timeout(Some(std::time::Duration::from_secs(1)))?;
    let mut buf = [0u8; 512];
    while !stop.load(Ordering::Relaxed) {
        let (len, from) = match socket.recv_from(&mut buf) {
            Ok(received) => received,
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return Err(e.into()),
        };
        if let Some((name, qtype)) = question(&buf[..len]) {
            log::info!("portal: dns {name} type {qtype} from {}", from.ip());
        }
        if let Some(reply) = dns_reply(&buf[..len], ip) {
            socket.send_to(&reply, from)?;
        }
    }
    Ok(())
}
