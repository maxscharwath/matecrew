//! Client for the site's device API. The shapes are in `matecrew_core::contract`.

use anyhow::{anyhow, Context, Result};
use embedded_svc::http::{client::Client, Method};
use embedded_svc::io::Write;
use esp_idf_svc::http::client::{Configuration, EspHttpConnection};
use matecrew_core::contract::{
    CommandsResponse, DeviceState, LinkError, LinkGranted, LinkStart, StatusReport, Take,
    TakesRequest, TakesResponse,
};
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;

/// The site proposed during setup; the person can pick another one there.
pub const DEFAULT_SITE: &str = match option_env!("MATECREW_URL") {
    Some(url) => url,
    None => "https://matecrew.vercel.app",
};

/// "https://matecrew.example.com" from what a person typed, or None if it is not a web address.
pub fn normalize_site(input: &str) -> Option<String> {
    let site = input.trim().trim_end_matches('/');
    let rest = site
        .strip_prefix("https://")
        .or_else(|| site.strip_prefix("http://"))?;
    (!rest.is_empty() && !rest.contains(char::is_whitespace)).then(|| site.to_owned())
}

/// The site without its scheme, for the screens: "matecrew.vercel.app".
pub fn host(site: &str) -> &str {
    site.trim_start_matches("https://")
        .trim_start_matches("http://")
}

pub enum LinkPoll {
    Granted(LinkGranted),
    Pending,
    SlowDown,
    /// Denied, expired or unknown: ask for a new code.
    Restart,
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
}

/// Time for an ordinary request.
const TIMEOUT: Duration = Duration::from_secs(20);
/// Longest wait for the next piece of a firmware download.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
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
    site: String,
    token: Option<String>,
}

impl Api {
    pub fn anonymous(site: &str) -> Self {
        Self {
            site: site.to_owned(),
            token: None,
        }
    }

    pub fn with_token(site: &str, token: String) -> Self {
        Self {
            site: site.to_owned(),
            token: Some(token),
        }
    }

    pub fn link_start(&self, hardware_id: &str) -> Result<LinkStart> {
        let body = serde_json::json!({ "hardwareId": hardware_id, "firmwareVersion": env!("CARGO_PKG_VERSION") });
        expect_json(self.send(
            Method::Post,
            "/api/device/link",
            Body::json(&body)?,
            TIMEOUT,
        )?)
    }

    pub fn link_poll(&self, device_code: &str) -> Result<LinkPoll> {
        let body = serde_json::json!({ "device_code": device_code });
        let reply = self.send(
            Method::Post,
            "/api/device/link/token",
            Body::json(&body)?,
            TIMEOUT,
        )?;
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

    pub fn app_bytecode(&self, path: &str) -> Result<Vec<u8>> {
        if !path.starts_with('/') || path.starts_with("//") {
            anyhow::bail!("app must be on this site");
        }
        let reply = self.send(Method::Get, path, Body::None, TIMEOUT)?;
        check(&reply)?;
        if reply.body.len() > 64 * 1024 {
            anyhow::bail!("app bytecode too large");
        }
        Ok(reply.body)
    }

    /// Same-site API data for portable bytecode apps; the renderer itself never owns HTTP.
    pub fn app_data(&self, path: &str) -> Result<serde_json::Value> {
        if !path.starts_with('/') || path.starts_with("//") {
            anyhow::bail!("app resource must be on this site");
        }
        expect_json(self.send(Method::Get, path, Body::None, TIMEOUT)?)
    }

    /// Original PNG bytes. Conversion and rendering happen in the device engine.
    pub fn app_image(&self, src: &str) -> Result<Vec<u8>> {
        use esp_idf_svc::http::client::FollowRedirectsPolicy;
        use matecrew_ui::engine::image::{valid_source, MAX_DOWNLOAD_BYTES};
        if !valid_source(src) {
            anyhow::bail!("invalid image URL");
        }
        let relative = src.starts_with('/');
        let url = if relative {
            format!("{}{src}", self.site)
        } else {
            src.to_owned()
        };
        let connection = EspHttpConnection::new(&Configuration {
            crt_bundle_attach: Some(esp_idf_svc::sys::esp_crt_bundle_attach),
            timeout: Some(TIMEOUT),
            follow_redirects_policy: FollowRedirectsPolicy::FollowNone,
            buffer_size: Some(4096),
            ..Default::default()
        })?;
        let mut client = Client::wrap(connection);
        let auth = self
            .token
            .as_ref()
            .filter(|_| relative)
            .map(|t| format!("Bearer {t}"));
        let mut headers = vec![("accept", "image/png")];
        if let Some(auth) = &auth {
            headers.push(("authorization", auth.as_str()));
        }
        let mut response = client.request(Method::Get, &url, &headers)?.submit()?;
        if response.status() != 200 {
            anyhow::bail!("image HTTP {}", response.status());
        }
        let mut bytes = Vec::new();
        let mut chunk = [0; 2048];
        loop {
            let count = response.read(&mut chunk)?;
            if count == 0 {
                break;
            }
            if bytes.len() + count > MAX_DOWNLOAD_BYTES {
                anyhow::bail!("image download exceeds 64 KiB");
            }
            bytes.extend_from_slice(&chunk[..count]);
        }
        Ok(bytes)
    }

    pub fn state(&self) -> Result<DeviceState> {
        expect_json(self.send(Method::Get, "/api/device/state", Body::None, TIMEOUT)?)
    }

    pub fn takes(&self, takes: &[Take]) -> Result<TakesResponse> {
        expect_json(self.send(
            Method::Post,
            "/api/device/takes",
            Body::json(&TakesRequest { takes })?,
            TIMEOUT,
        )?)
    }

    /// Console commands from the site, waiting up to 25 s for one to arrive.
    pub fn commands(&self) -> Result<CommandsResponse> {
        let path = format!("/api/device/commands?wait={COMMANDS_WAIT_SECONDS}");
        let timeout = Duration::from_secs(COMMANDS_WAIT_SECONDS + 10);
        expect_json(self.send(Method::Get, &path, Body::None, timeout)?)
    }

    /// What the panel shows, for the site's console. Packed 1-bit pixels generated by the device.
    pub fn put_frame(&self, frame: &[u8]) -> Result<()> {
        check(&self.send(
            Method::Put,
            "/api/device/frame",
            Body::Bytes(frame),
            TIMEOUT,
        )?)
    }

    pub fn status(&self, status: &StatusReport) -> Result<()> {
        check(&self.send(
            Method::Post,
            "/api/device/status",
            Body::json(status)?,
            TIMEOUT,
        )?)
    }

    /// Downloads `path` and hands it over in pieces as they arrive, for a
    /// firmware too big to hold in memory. Fails unless the site answers 200.
    pub fn download(&self, path: &str, mut piece: impl FnMut(&[u8]) -> Result<()>) -> Result<()> {
        let connection = EspHttpConnection::new(&Configuration {
            crt_bundle_attach: Some(esp_idf_svc::sys::esp_crt_bundle_attach),
            timeout: Some(DOWNLOAD_TIMEOUT),
            buffer_size: Some(4096),
            ..Default::default()
        })?;
        let mut client = Client::wrap(connection);
        let url = format!("{}{path}", self.site);
        let auth = self
            .token
            .as_ref()
            .map(|t| format!("Bearer {t}"))
            .unwrap_or_default();
        let headers = [("authorization", auth.as_str())];
        let mut response = client.request(Method::Get, &url, &headers)?.submit()?;
        let status = response.status();
        log::info!("GET {path} -> {status}");
        if status == 401 {
            return Err(Unauthorized.into());
        }
        if status != 200 {
            return Err(anyhow!("GET {path}: {status}"));
        }
        let mut buf = vec![0u8; 4096];
        loop {
            let read = response.read(&mut buf)?;
            if read == 0 {
                return Ok(());
            }
            piece(&buf[..read])?;
        }
    }

    fn send(&self, method: Method, path: &str, body: Body, timeout: Duration) -> Result<Reply> {
        let connection = EspHttpConnection::new(&Configuration {
            crt_bundle_attach: Some(esp_idf_svc::sys::esp_crt_bundle_attach),
            timeout: Some(timeout),
            buffer_size: Some(4096),
            buffer_size_tx: Some(1024),
            ..Default::default()
        })?;
        let mut client = Client::wrap(connection);
        let url = format!("{}{path}", self.site);
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

        let mut request = client.request(method, &url, &headers)?;
        if let Some(payload) = payload {
            request.write_all(payload)?;
            request.flush()?;
        }
        let mut response = request.submit()?;
        let status = response.status();
        // Size the response up front to avoid repeated allocations on the device.
        let expected = response
            .header("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        let mut body = Vec::with_capacity(expected.min(64 * 1024));
        let mut chunk = [0u8; 1024];
        loop {
            let read = response.read(&mut chunk)?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
        log::info!(
            "{} {path} -> {status} ({} bytes)",
            method_name(method),
            body.len()
        );
        if status == 401 {
            return Err(Unauthorized.into());
        }
        Ok(Reply { status, body })
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
        Err(anyhow!(
            "server answered {}: {}",
            reply.status,
            String::from_utf8_lossy(&reply.body)
        ))
    }
}

fn expect_json<T: DeserializeOwned>(reply: Reply) -> Result<T> {
    check(&reply)?;
    Ok(serde_json::from_slice(&reply.body)?)
}
