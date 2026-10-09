//! Client for the site's device API. The shapes are in `matecrew_core::contract`.

use anyhow::{anyhow, Context, Result};
use embedded_svc::http::{client::Client, Method};
use embedded_svc::io::Write;
use esp_idf_svc::http::client::{Configuration, EspHttpConnection};
use matecrew_core::contract::{
    CommandsResponse, DeviceState, LinkError, LinkGranted, LinkStart, StatusReport, Take, TakesRequest, TakesResponse,
};
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;

pub const BASE_URL: &str = match option_env!("MATECREW_URL") {
    Some(url) => url,
    None => "https://matecrew.vercel.app",
};

pub enum LinkPoll {
    Granted(LinkGranted),
    Pending,
    SlowDown,
    /// Denied, expired or unknown: ask for a new code.
    Restart,
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

/// Time for an ordinary request.
const TIMEOUT: Duration = Duration::from_secs(20);
/// How long the site holds a commands request when there is nothing to say.
const COMMANDS_WAIT_SECONDS: u64 = 25;

enum Body<'a> {
    None,
    Json(Vec<u8>),
    Bytes(&'a [u8]),
}

impl Body<'_> {
    fn json(value: &impl Serialize) -> Result<Self> {
        Ok(Body::Json(serde_json::to_vec(value)?))
    }
}

#[derive(Clone)]
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
        expect_json(self.send(Method::Post, "/api/device/link", Body::json(&body)?, None, TIMEOUT)?)
    }

    pub fn link_poll(&self, device_code: &str) -> Result<LinkPoll> {
        let body = serde_json::json!({ "device_code": device_code });
        let reply = self.send(Method::Post, "/api/device/link/token", Body::json(&body)?, None, TIMEOUT)?;
        if reply.status == 200 {
            return Ok(LinkPoll::Granted(serde_json::from_slice(&reply.body)?));
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
        expect_json(self.send(Method::Get, "/api/device/state", Body::None, None, TIMEOUT)?)
    }

    pub fn takes(&self, takes: &[Take]) -> Result<TakesResponse> {
        expect_json(self.send(Method::Post, "/api/device/takes", Body::json(&TakesRequest { takes })?, None, TIMEOUT)?)
    }

    /// Console commands from the site, waiting up to 25 s for one to arrive.
    pub fn commands(&self) -> Result<CommandsResponse> {
        let path = format!("/api/device/commands?wait={COMMANDS_WAIT_SECONDS}");
        let timeout = Duration::from_secs(COMMANDS_WAIT_SECONDS + 10);
        expect_json(self.send(Method::Get, &path, Body::None, None, timeout)?)
    }

    /// What the panel shows, for the site's console. Same format as `screen`.
    pub fn put_frame(&self, frame: &[u8]) -> Result<()> {
        check(&self.send(Method::Put, "/api/device/frame", Body::Bytes(frame), None, TIMEOUT)?)
    }

    pub fn status(&self, status: &StatusReport) -> Result<()> {
        check(&self.send(Method::Post, "/api/device/status", Body::json(status)?, None, TIMEOUT)?)
    }

    pub fn screen(&self, etag: Option<&str>) -> Result<ScreenUpdate> {
        let reply = self.send(Method::Get, "/api/device/screen", Body::None, etag, TIMEOUT)?;
        if reply.status == 304 {
            return Ok(ScreenUpdate::Unchanged);
        }
        check(&reply)?;
        Ok(ScreenUpdate::Changed { bits: reply.body, etag: reply.etag })
    }

    fn send(&self, method: Method, path: &str, body: Body, if_none_match: Option<&str>, timeout: Duration) -> Result<Reply> {
        let connection = EspHttpConnection::new(&Configuration {
            crt_bundle_attach: Some(esp_idf_svc::sys::esp_crt_bundle_attach),
            timeout: Some(timeout),
            buffer_size: Some(4096),
            buffer_size_tx: Some(1024),
            ..Default::default()
        })?;
        let mut client = Client::wrap(connection);
        let url = format!("{BASE_URL}{path}");
        let (payload, content_type) = match &body {
            Body::None => (None, None),
            Body::Json(json) => (Some(json.as_slice()), Some("application/json")),
            Body::Bytes(bytes) => (Some(*bytes), Some("application/octet-stream")),
        };

        let auth = self.token.as_ref().map(|t| format!("Bearer {t}"));
        let length = payload.as_ref().map(|p| p.len().to_string());
        let mut headers: Vec<(&str, &str)> = vec![("accept", "application/json")];
        if let Some(auth) = &auth {
            headers.push(("authorization", auth));
        }
        if let (Some(length), Some(content_type)) = (&length, content_type) {
            headers.push(("content-type", content_type));
            headers.push(("content-length", length));
        }
        if let Some(etag) = if_none_match {
            headers.push(("if-none-match", etag));
        }

        let mut request = client.request(method, &url, &headers)?;
        if let Some(payload) = payload {
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
        Method::Put => "PUT",
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
