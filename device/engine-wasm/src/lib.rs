//! The SDK's renderer: one stateless call turns DUI bytecode plus a preview description
//! into the panel's 1-bit pixels, exactly as the device engine draws them.
//!
//! C ABI, JSON in, bytes out (no wasm-bindgen, no imports):
//! - `alloc` / `dealloc`: memory the host writes bytecode and JSON into.
//! - `preview(dui, dui_len, spec, spec_len)`: renders; returns the frame length, or -1 with
//!   a UTF-8 error message as output.
//! - `output_ptr` / `output_len`: the last output (packed frame, MSB first, 1 = ink, rows
//!   padded to whole bytes); `frame_width` / `frame_height`: its size.
//! - `effects_ptr` / `effects_len`: JSON array of the effects the preview's events produced.
//!
//! A trap (panic aborts) poisons this instance: the host instantiates the module again.

//!
//! The emulator keeps one running app instead (`session_*`, see [`session`]), plus `tone` and
//! `pins` from the board crate.

pub mod session;

use device_engine::{frame::Frame, Effect, Point, Runtime, Scene, Theme};
use serde::Deserialize;
use serde_json::Value;
use std::cell::RefCell;

/// Everything that decides a frame. Applied in order: cache, device, events, then `data` overlays.
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Preview {
    /// Offline cache shape: resources by id, `local` state, `$navigation.stack`, `$images`.
    pub cache: Value,
    /// Host metadata exposed as `$device.*`.
    pub device: Value,
    /// Top-level binding roots merged over the runtime's data, e.g. `view` for host-driven screens.
    pub data: Value,
    pub events: Vec<Event>,
    /// Theme override; otherwise the app's own `local.theme`.
    pub theme: Option<String>,
    /// Panel the app is fitted on; 800 × 480 by default.
    pub panel: Option<[u32; 2]>,
    /// PNG bytes (base64) answering the scene's web image requests, by `src`.
    pub images: std::collections::BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    /// A tap in the app's logical coordinates.
    Press { x: i32, y: i32 },
    /// A named hardware input, such as `left` or `right`.
    Input { name: String },
    /// Run a compiled action by id.
    Action { id: String },
    /// Advance the monotonic clock (toasts expire).
    Tick { ms: u64 },
    Notify {
        message: String,
        #[serde(default = "default_toast_ms")]
        duration_ms: u32,
    },
}
fn default_toast_ms() -> u32 {
    5000
}

pub struct Rendered {
    pub frame: Frame,
    pub width: u32,
    pub height: u32,
    pub effects: Vec<Effect>,
}

/// Decode, replay the preview, and draw. Shared by the C ABI and native tests.
pub fn render(bytecode: &[u8], preview: &Preview) -> Result<Rendered, String> {
    let scene = Scene::from_bytecode(bytecode).map_err(|error| format!("invalid bytecode: {error}"))?;
    let mut runtime = Runtime::new(scene).map_err(|error| format!("invalid scene: {error}"))?;
    if !preview.cache.is_null() {
        runtime.restore(&preview.cache);
    }
    if preview.device.is_object() {
        runtime.update_device(preview.device.clone());
    }
    let mut effects = Vec::new();
    let mut now = 0;
    for event in &preview.events {
        match event {
            Event::Press { x, y } => effects.extend(runtime.press(Point::new(*x, *y))),
            Event::Input { name } => effects.extend(runtime.input(name).unwrap_or_default()),
            Event::Action { id } => effects.extend(runtime.handle(id)),
            Event::Tick { ms } => {
                now += ms;
                runtime.tick(now);
            }
            Event::Notify { message, duration_ms } => {
                runtime.notify(message, *duration_ms, now);
            }
        }
    }
    for request in runtime.image_requests() {
        if let Some(png) = preview.images.get(&request.src) {
            let bytes = base64(png).ok_or_else(|| format!("{}: invalid base64", request.src))?;
            runtime
                .update_image(&request, &bytes)
                .map_err(|error| format!("{}: {error}", request.src))?;
        }
    }
    let mut data = runtime.data().clone();
    if let (Some(target), Some(extra)) = (data.as_object_mut(), preview.data.as_object()) {
        for (key, value) in extra {
            target.insert(key.clone(), value.clone());
        }
    }
    let scene = runtime.scene();
    let [width, height] = preview.panel.unwrap_or([800, 480]);
    let scale = (width / scene.width).min(height / scene.height).max(1);
    let mut frame = Frame::new(width, height).ok_or("invalid panel size")?;
    let _ = match &preview.theme {
        Some(theme) => scene.render_with_theme(&mut frame, &data, scale, Theme::from_name(theme)),
        None => scene.render(&mut frame, &data, scale),
    };
    Ok(Rendered { frame, width, height, effects })
}

pub(crate) fn base64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let digits: Vec<u8> = text.bytes().filter(|c| *c != b'=').map(value).collect::<Option<_>>()?;
    Some(
        digits
            .chunks(4)
            .flat_map(|chunk| {
                let n = chunk.iter().enumerate().fold(0u32, |n, (i, d)| n | (u32::from(*d) << (18 - 6 * i)));
                (0..chunk.len().saturating_sub(1)).map(move |i| (n >> (16 - 8 * i)) as u8)
            })
            .collect(),
    )
}

thread_local! {
    pub(crate) static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static EFFECTS: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    pub(crate) static SIZE: RefCell<[u32; 2]> = const { RefCell::new([0, 0]) };
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut bytes = Vec::<u8>::with_capacity(len);
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

/// # Safety
/// `ptr` and `len` must come from `alloc`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// # Safety
/// Both buffers come from `alloc` with their exact lengths; they are consumed by this call.
#[no_mangle]
pub unsafe extern "C" fn preview(dui: *mut u8, dui_len: usize, spec: *mut u8, spec_len: usize) -> i32 {
    let bytecode = Vec::from_raw_parts(dui, dui_len, dui_len);
    let spec = Vec::from_raw_parts(spec, spec_len, spec_len);
    let result = serde_json::from_slice::<Preview>(&spec)
        .map_err(|error| format!("invalid preview: {error}"))
        .and_then(|preview| render(&bytecode, &preview));
    match result {
        Ok(rendered) => {
            let len = rendered.frame.bits.len() as i32;
            SIZE.set([rendered.width, rendered.height]);
            EFFECTS.set(serde_json::to_vec(&rendered.effects).unwrap_or_default());
            OUTPUT.set(rendered.frame.bits);
            len
        }
        Err(message) => {
            OUTPUT.set(message.into_bytes());
            EFFECTS.set(b"[]".to_vec());
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with_borrow(|output| output.as_ptr())
}
#[no_mangle]
pub extern "C" fn output_len() -> usize {
    OUTPUT.with_borrow(Vec::len)
}
#[no_mangle]
pub extern "C" fn effects_ptr() -> *const u8 {
    EFFECTS.with_borrow(|effects| effects.as_ptr())
}
#[no_mangle]
pub extern "C" fn effects_len() -> usize {
    EFFECTS.with_borrow(Vec::len)
}
#[no_mangle]
pub extern "C" fn frame_width() -> u32 {
    SIZE.with_borrow(|size| size[0])
}
#[no_mangle]
pub extern "C" fn frame_height() -> u32 {
    SIZE.with_borrow(|size| size[1])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const APP: &[u8] = include_bytes!("../../engine/tests/fixtures/app.dui");

    fn preview(spec: Value) -> Rendered {
        render(APP, &serde_json::from_value(spec).unwrap()).unwrap()
    }
    #[test]
    fn previews_are_deterministic_and_follow_their_data() {
        let empty = preview(json!({}));
        assert_eq!(empty.frame.bits.len(), 800 * 480 / 8);
        assert_eq!(preview(json!({})).frame.bits, empty.frame.bits);
        let stocked = preview(json!({"cache":{"stock":{"office":{"name":"Lausanne"}}}}));
        assert_ne!(stocked.frame.bits, empty.frame.bits);
    }
    #[test]
    fn events_replay_actions_and_report_effects() {
        let before = preview(json!({}));
        // "Aide" sets local state; "Prendre" emits a host event.
        let after = preview(json!({"events":[{"kind":"press","x":670,"y":452}]}));
        assert_ne!(after.frame.bits, before.frame.bits);
        let emitted = preview(json!({"events":[{"kind":"press","x":130,"y":452}]}));
        assert_eq!(emitted.effects, vec![Effect::Emit { name: "take".into() }]);
    }
    #[test]
    fn base64_round_trips_padding() {
        assert_eq!(base64("aGk=").unwrap(), b"hi");
        assert_eq!(base64("aGV5").unwrap(), b"hey");
        assert_eq!(base64("aA==").unwrap(), b"h");
        assert!(base64("a$==").is_none());
    }
    #[test]
    fn invalid_bytecode_is_an_error_not_a_blank_frame() {
        assert!(render(b"DUI1", &Preview::default()).is_err());
    }
}
