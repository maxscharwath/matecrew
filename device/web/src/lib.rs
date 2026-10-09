//! The virtual device's Rust half: the terminal's take flow and its screens,
//! drawn into the site's 1-bit format. The page (src/lib/device/virtual) runs
//! the network side and calls in through a small C ABI with JSON:
//!
//! - `alloc` / `dealloc`: memory for the JSON the page writes in.
//! - `render(ptr, len)`: draws a [`View`] into the frame; 0 on success.
//! - `frame_ptr` / `frame_len`: the 48 000 bytes of the last frame.
//! - `set_state(ptr, len)`: the `/api/device/state` the flow reads badges and keys from.
//! - `handle(ptr, len)`: feeds an [`Input`] to the flow; the effects, as JSON,
//!   are at `output_ptr` and the return value is their length.
//! - `deadline`: when to send the next tick, -1 for none.

mod frame;

use frame::{Frame, BYTES};
use matecrew_core::{
    contract::DeviceState,
    flow::{Context, Event, Flow, Screen},
};
use matecrew_ui as ui;
use serde::Deserialize;
use std::cell::RefCell;

/// A screen the terminal draws itself, as the page describes it.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum View {
    Test,
    Connecting { ssid: String },
    #[serde(rename_all = "camelCase")]
    Link { code: String, url: String, url_with_code: String },
    Linked { office: String, name: String },
    Error { title: String, detail: String },
    /// A screen of the take flow, as an effect gave it.
    Flow { screen: Screen },
}

/// An event for the flow, with what the page knows when it happens.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub event: Event,
    pub now_ms: u64,
    pub unix: Option<i64>,
    pub random: u64,
}

pub fn draw(frame: &mut Frame, view: &View) {
    let _ = match view {
        View::Test => ui::test_screen(frame),
        View::Connecting { ssid } => ui::connecting_screen(frame, ssid),
        View::Link { code, url, url_with_code } => ui::link_screen(frame, &ui::LinkInfo { code, url, url_with_code }),
        View::Linked { office, name } => ui::linked_screen(frame, office, name),
        View::Error { title, detail } => ui::error_screen(frame, title, detail),
        View::Flow { screen } => ui::flow_screen(frame, screen),
    };
}

thread_local! {
    static FRAME: RefCell<Frame> = RefCell::new(Frame::new());
    static FLOW: RefCell<Flow> = RefCell::new(Flow::new());
    static STATE: RefCell<Option<DeviceState>> = const { RefCell::new(None) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Reads the JSON the page wrote at `ptr` and gives the memory back.
unsafe fn take_json<T: for<'de> Deserialize<'de>>(ptr: *mut u8, len: usize) -> Option<T> {
    let bytes = Vec::from_raw_parts(ptr, len, len);
    serde_json::from_slice(&bytes).ok()
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
/// `ptr` must come from `alloc(len)` and hold `len` bytes of JSON. It is freed.
#[no_mangle]
pub unsafe extern "C" fn render(ptr: *mut u8, len: usize) -> i32 {
    let Some(view) = take_json::<View>(ptr, len) else { return -1 };
    FRAME.with_borrow_mut(|frame| draw(frame, &view));
    0
}

#[no_mangle]
pub extern "C" fn frame_ptr() -> *const u8 {
    FRAME.with_borrow(|frame| frame.bits.as_ptr())
}

#[no_mangle]
pub extern "C" fn frame_len() -> usize {
    BYTES
}

/// # Safety
/// As for `render`.
#[no_mangle]
pub unsafe extern "C" fn set_state(ptr: *mut u8, len: usize) -> i32 {
    let Some(state) = take_json::<DeviceState>(ptr, len) else { return -1 };
    STATE.set(Some(state));
    0
}

/// # Safety
/// As for `render`.
#[no_mangle]
pub unsafe extern "C" fn handle(ptr: *mut u8, len: usize) -> i32 {
    let Some(input) = take_json::<Input>(ptr, len) else { return -1 };
    let effects = STATE.with_borrow(|state| {
        let cx = Context { now_ms: input.now_ms, unix: input.unix, state: state.as_ref(), random: input.random };
        FLOW.with_borrow_mut(|flow| flow.handle(input.event, cx))
    });
    let json = serde_json::to_vec(&effects).unwrap_or_default();
    let len = json.len() as i32;
    OUTPUT.set(json);
    len
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with_borrow(|output| output.as_ptr())
}

/// Milliseconds, in the `nowMs` clock, at which to send a tick; -1 for none.
#[no_mangle]
pub extern "C" fn deadline() -> f64 {
    FLOW.with_borrow(|flow| flow.deadline().map_or(-1.0, |ms| ms as f64))
}

/// Back to idle, as after a reboot.
#[no_mangle]
pub extern "C" fn reset() {
    FLOW.set(Flow::new());
}
