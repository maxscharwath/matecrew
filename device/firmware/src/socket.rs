//! A WebSocket to the relay, on ESP-IDF's own transports: `esp_transport_ws` over
//! `esp_transport_ssl` (TLS with the same certificate bundle as the HTTP client), or over plain TCP
//! for a local `ws://` relay. No component to download, nothing new in the image but the
//! WebSocket framing, which ESP-IDF already builds.
//!
//! Like `esp_websocket_client`, one thread waits for data without the lock (`readable`) and every
//! read or write takes it: mbedTLS does not read and write one session from two threads at once.

use anyhow::{anyhow, bail, Result};
use esp_idf_svc::sys::{
    esp_crt_bundle_attach, esp_transport_close, esp_transport_connect, esp_transport_destroy,
    esp_transport_get_socket, esp_transport_handle_t, esp_transport_poll_read, esp_transport_read,
    esp_transport_ssl_crt_bundle_attach, esp_transport_ssl_init, esp_transport_tcp_init,
    esp_transport_ws_config_t, esp_transport_ws_get_fin_flag, esp_transport_ws_get_read_opcode,
    esp_transport_ws_get_read_payload_len, esp_transport_ws_get_upgrade_request_status, esp_transport_ws_init,
    esp_transport_ws_send_raw, esp_transport_ws_set_config, lwip_setsockopt, ws_transport_opcodes_t,
    ws_transport_opcodes_WS_TRANSPORT_OPCODES_BINARY as BINARY, ws_transport_opcodes_WS_TRANSPORT_OPCODES_CLOSE as CLOSE,
    ws_transport_opcodes_WS_TRANSPORT_OPCODES_FIN as FIN, ws_transport_opcodes_WS_TRANSPORT_OPCODES_PING as PING,
    ws_transport_opcodes_WS_TRANSPORT_OPCODES_PONG as PONG, ws_transport_opcodes_WS_TRANSPORT_OPCODES_TEXT as TEXT,
    IPPROTO_TCP, TCP_NODELAY,
};
use matecrew_core::live::split_url;
use std::{ffi::CString, sync::Mutex, time::Duration};

/// Longest message the terminal reads: the relay only sends small JSON.
const MAX_MESSAGE: usize = 8 * 1024;

/// The relay answered the upgrade with this HTTP status instead of 101.
#[derive(Debug)]
pub struct Refused(pub u16);

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "relay refused the socket: HTTP {}", self.0)
    }
}

impl std::error::Error for Refused {}

pub enum Message {
    Text(String),
    /// The relay sends the terminal none.
    Binary,
    Ping(Vec<u8>),
    Pong,
    Close,
}

/// An open WebSocket. Dropping it closes the connection.
pub struct Socket {
    ws: esp_transport_handle_t,
    parent: esp_transport_handle_t,
    /// Taken for every read and write.
    lock: Mutex<()>,
    /// The upgrade's path, subprotocol and Authorization, which the transport points to.
    _strings: [CString; 3],
}

// SAFETY: the handles are only used under `lock`, except `readable`, which only polls the socket,
// as `esp_websocket_client` does from its own task.
unsafe impl Send for Socket {}
unsafe impl Sync for Socket {}

impl Socket {
    /// Opens `url` with `token` (sent as `Authorization: Bearer`), asking for `subprotocol`.
    pub fn connect(url: &str, token: &str, subprotocol: &str, timeout: Duration) -> Result<Self> {
        let (tls, host, port, path) = split_url(url).ok_or_else(|| anyhow!("not a WebSocket address: {url}"))?;
        let strings = [CString::new(path)?, CString::new(subprotocol)?, CString::new(format!("Bearer {token}"))?];
        let host = CString::new(host)?;
        // SAFETY: plain ESP-IDF calls; every handle created here is destroyed by `Drop`, or below
        // when one of them could not be created.
        unsafe {
            let parent = if tls { esp_transport_ssl_init() } else { esp_transport_tcp_init() };
            if parent.is_null() {
                bail!("no memory for the relay's transport");
            }
            if tls {
                esp_transport_ssl_crt_bundle_attach(parent, Some(esp_crt_bundle_attach));
            }
            let ws = esp_transport_ws_init(parent);
            if ws.is_null() {
                esp_transport_destroy(parent);
                bail!("no memory for the relay's WebSocket");
            }
            let socket = Self { ws, parent, lock: Mutex::new(()), _strings: strings };
            let config = esp_transport_ws_config_t {
                ws_path: socket._strings[0].as_ptr(),
                sub_protocol: socket._strings[1].as_ptr(),
                auth: socket._strings[2].as_ptr(),
                // Pings and closes come to `read`: the terminal answers them itself.
                propagate_control_frames: true,
                ..Default::default()
            };
            esp_idf_svc::sys::esp!(esp_transport_ws_set_config(ws, &config))?;
            let millis = timeout.as_millis() as i32;
            if esp_transport_connect(ws, host.as_ptr(), i32::from(port), millis) < 0 {
                let status = esp_transport_ws_get_upgrade_request_status(ws);
                if status > 0 && status != 101 {
                    return Err(Refused(status as u16).into());
                }
                bail!("could not reach the relay at {url}");
            }
            // Commands and acknowledgments are a few bytes: send them now, not with the next segment.
            let fd = esp_transport_get_socket(ws);
            if fd >= 0 {
                let on: i32 = 1;
                lwip_setsockopt(fd, IPPROTO_TCP as i32, TCP_NODELAY as i32, (&on as *const i32).cast(), 4);
            }
            Ok(socket)
        }
    }

    /// Whether data waits, within `timeout`; an error once the connection is gone.
    pub fn readable(&self, timeout: Duration) -> Result<bool> {
        // SAFETY: only polls the descriptor (and what TLS already decrypted).
        match unsafe { esp_transport_poll_read(self.ws, timeout.as_millis() as i32) } {
            0 => Ok(false),
            n if n > 0 => Ok(true),
            _ => bail!("relay connection lost"),
        }
    }

    /// One whole message; `None` for an empty one or a fragment (the relay sends neither).
    pub fn read(&self, timeout: Duration) -> Result<Option<Message>> {
        let _held = self.lock.lock().map_err(|_| anyhow!("socket lock poisoned"))?;
        let millis = timeout.as_millis() as i32;
        let mut buffer = vec![0u8; 1024];
        // SAFETY: the buffer outlives each call and is as long as said.
        let first = unsafe { esp_transport_read(self.ws, buffer.as_mut_ptr().cast(), buffer.len() as i32, millis) };
        if first < 0 {
            bail!("relay connection lost ({first})");
        }
        let (opcode, length, fin) = unsafe {
            (
                esp_transport_ws_get_read_opcode(self.ws),
                esp_transport_ws_get_read_payload_len(self.ws).max(0) as usize,
                esp_transport_ws_get_fin_flag(self.ws),
            )
        };
        if first == 0 && length > 0 {
            return Ok(None);
        }
        let mut read = first as usize;
        if length > MAX_MESSAGE {
            bail!("relay message too long ({length} bytes)");
        }
        buffer.resize(length.max(read), 0);
        while read < length {
            // SAFETY: as above, on the rest of the buffer.
            let more = unsafe {
                esp_transport_read(self.ws, buffer[read..].as_mut_ptr().cast(), (length - read) as i32, millis)
            };
            if more <= 0 {
                bail!("relay message cut short");
            }
            read += more as usize;
        }
        buffer.truncate(length);
        if !fin {
            log::warn!("socket: fragmented message dropped");
            return Ok(None);
        }
        Ok(match opcode & 0x0f {
            o if o == TEXT => Some(Message::Text(String::from_utf8_lossy(&buffer).into_owned())),
            o if o == BINARY => Some(Message::Binary),
            o if o == PING => Some(Message::Ping(buffer)),
            o if o == PONG => Some(Message::Pong),
            o if o == CLOSE => Some(Message::Close),
            _ => None,
        })
    }

    pub fn send_text(&self, text: &str, timeout: Duration) -> Result<()> {
        self.send(TEXT, text.as_bytes().to_vec(), timeout)
    }

    pub fn send_binary(&self, data: Vec<u8>, timeout: Duration) -> Result<()> {
        self.send(BINARY, data, timeout)
    }

    pub fn pong(&self, payload: Vec<u8>, timeout: Duration) -> Result<()> {
        self.send(PONG, payload, timeout)
    }

    /// One unfragmented message. The transport masks the payload in place, then restores it: it
    /// gets a buffer of its own.
    fn send(&self, opcode: ws_transport_opcodes_t, mut data: Vec<u8>, timeout: Duration) -> Result<()> {
        let _held = self.lock.lock().map_err(|_| anyhow!("socket lock poisoned"))?;
        // SAFETY: `data` lives through the call; the transport writes into it and restores it.
        let sent = unsafe {
            esp_transport_ws_send_raw(self.ws, opcode | FIN, data.as_mut_ptr().cast(), data.len() as i32, timeout.as_millis() as i32)
        };
        if sent < 0 || (sent as usize) < data.len() {
            bail!("relay send failed ({sent})");
        }
        Ok(())
    }
}

impl Drop for Socket {
    fn drop(&mut self) {
        let _held = self.lock.lock();
        // SAFETY: the handles were created in `connect` and nothing uses them after this.
        unsafe {
            esp_transport_close(self.ws);
            esp_transport_destroy(self.ws);
            esp_transport_destroy(self.parent);
        }
    }
}
