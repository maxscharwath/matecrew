//! Client for the site's device API. Shapes mirror src/lib/device/contract.ts.

use anyhow::{anyhow, Context, Result};
use embedded_svc::http::{client::Client, Method};
use embedded_svc::io::Write;
use esp_idf_svc::http::client::{Configuration, EspHttpConnection};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;

pub const BASE_URL: &str = match option_env!("MATECREW_URL") {
    Some(url) => url,
    None => "https://matecrew.vercel.app",
};

#[derive(Deserialize)]
pub struct LinkStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
pub struct LinkGranted {
    pub access_token: String,
    pub device_name: String,
    pub office_name: String,
}

pub enum LinkPoll {
    Granted(LinkGranted),
    Pending,
    SlowDown,
    /// Denied, expired or unknown: ask for a new code.
    Restart,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Read once the terminal works offline (keys, badges).
pub struct DeviceState {
    pub device: Named,
    pub office: Office,
    pub badges: Vec<BadgeEntry>,
    pub sync_times: Vec<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct Named {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct Office {
    pub name: String,
    pub timezone: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct BadgeEntry {
    pub uid: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport<'a> {
    pub firmware_version: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wifi_rssi: Option<i8>,
    pub unknown_badges: Vec<String>,
}

pub enum ScreenUpdate {
    Unchanged,
    Changed { bits: Vec<u8>, etag: Option<String> },
}

#[derive(Debug)]
pub struct Unauthorized;

impl std::fmt::Display for Unauthorized {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the site no longer knows this device")
    }
}

impl std::error::Error for Unauthorized {}

struct Reply {
    status: u16,
    body: Vec<u8>,
    etag: Option<String>,
}

pub struct Api {
    token: Option<String>,
}

impl Api {
    pub fn anonymous() -> Self {
        Self { token: None }
    }

    pub fn with_token(token: String) -> Self {
        Self { token: Some(token) }
    }

    pub fn link_start(&self, hardware_id: &str) -> Result<LinkStart> {
        let body = serde_json::json!({ "hardwareId": hardware_id, "firmwareVersion": env!("CARGO_PKG_VERSION") });
        let reply = self.send(Method::Post, "/api/device/link", Some(&body), None)?;
        expect_json(reply)
    }

    pub fn link_poll(&self, device_code: &str) -> Result<LinkPoll> {
        let body = serde_json::json!({ "device_code": device_code });
        let reply = self.send(Method::Post, "/api/device/link/token", Some(&body), None)?;
        if reply.status == 200 {
            return Ok(LinkPoll::Granted(serde_json::from_slice(&reply.body)?));
        }
        #[derive(Deserialize)]
        struct LinkError {
            error: String,
        }
        let error: LinkError = serde_json::from_slice(&reply.body)
            .with_context(|| format!("link poll answered {}", reply.status))?;
        Ok(match error.error.as_str() {
            "authorization_pending" => LinkPoll::Pending,
            "slow_down" => LinkPoll::SlowDown,
            _ => LinkPoll::Restart,
        })
    }

    pub fn state(&self) -> Result<DeviceState> {
        expect_json(self.send(Method::Get, "/api/device/state", None::<&()>, None)?)
    }

    pub fn status(&self, status: &StatusReport) -> Result<()> {
        let reply = self.send(Method::Post, "/api/device/status", Some(status), None)?;
        check(&reply)
    }

    pub fn screen(&self, etag: Option<&str>) -> Result<ScreenUpdate> {
        let reply = self.send(Method::Get, "/api/device/screen", None::<&()>, etag)?;
        if reply.status == 304 {
            return Ok(ScreenUpdate::Unchanged);
        }
        check(&reply)?;
        Ok(ScreenUpdate::Changed { bits: reply.body, etag: reply.etag })
    }

    fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<&impl Serialize>,
        if_none_match: Option<&str>,
    ) -> Result<Reply> {
        let connection = EspHttpConnection::new(&Configuration {
            crt_bundle_attach: Some(esp_idf_svc::sys::esp_crt_bundle_attach),
            timeout: Some(Duration::from_secs(20)),
            buffer_size: Some(4096),
            buffer_size_tx: Some(1024),
            ..Default::default()
        })?;
        let mut client = Client::wrap(connection);
        let url = format!("{BASE_URL}{path}");
        let payload = body.map(serde_json::to_vec).transpose()?;

        let auth = self.token.as_ref().map(|t| format!("Bearer {t}"));
        let length = payload.as_ref().map(|p| p.len().to_string());
        let mut headers: Vec<(&str, &str)> = vec![("accept", "application/json")];
        if let Some(auth) = &auth {
            headers.push(("authorization", auth));
        }
        if let Some(length) = &length {
            headers.push(("content-type", "application/json"));
            headers.push(("content-length", length));
        }
        if let Some(etag) = if_none_match {
            headers.push(("if-none-match", etag));
        }

        let mut request = client.request(method, &url, &headers)?;
        if let Some(payload) = &payload {
            request.write_all(payload)?;
            request.flush()?;
        }
        let mut response = request.submit()?;
        let status = response.status();
        let etag = response.header("etag").map(str::to_owned);
        let mut body = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = response.read(&mut chunk)?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
        log::info!("{} {path} -> {status} ({} bytes)", method_name(method), body.len());
        if status == 401 {
            return Err(Unauthorized.into());
        }
        Ok(Reply { status, body, etag })
    }
}

fn method_name(method: Method) -> &'static str {
    match method {
        Method::Get => "GET",
        Method::Post => "POST",
        _ => "HTTP",
    }
}

fn check(reply: &Reply) -> Result<()> {
    if (200..300).contains(&reply.status) {
        Ok(())
    } else {
        Err(anyhow!("server answered {}: {}", reply.status, String::from_utf8_lossy(&reply.body)))
    }
}

fn expect_json<T: DeserializeOwned>(reply: Reply) -> Result<T> {
    check(&reply)?;
    Ok(serde_json::from_slice(&reply.body)?)
}
