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

use matecrew_core::{
    claim::Claim,
    contract::{DeviceScreen, DeviceState},
    flow::{Context, Event, Flow, Screen},
};
use matecrew_ui as ui;
use matecrew_ui::frame::{Frame, BYTES};
use serde::Deserialize;
use std::cell::RefCell;
thread_local! { static KEYS: RefCell<matecrew_core::hardware::TouchKeys> = RefCell::default(); }
/// Sample GPIO 5 and 8 at `now_ms`: 1 the left key, 2 the right key, 4 both together, 0 nothing.
/// Call it every `KEY_POLL_MS`: a lone key comes out once the other could no longer join it.
#[no_mangle]
pub extern "C" fn gpio_sample(left: u32, right: u32, now_ms: f64) -> u32 {
    use matecrew_core::{contract::Side, flow::Event};
    KEYS.with_borrow_mut(|keys| match keys.sample(left != 0, right != 0, now_ms.max(0.0) as u64) {
        Some(Event::Key { side: Side::Left }) => 1,
        Some(Event::Key { side: Side::Right }) => 2,
        Some(Event::BothKeys) => 4,
        _ => 0,
    })
}
#[no_mangle]
pub extern "C" fn buzzer_pattern(tone: u32) -> i32 {
    let beep = match tone {
        1 => matecrew_core::flow::Beep::Accepted,
        2 => matecrew_core::flow::Beep::Error,
        3 => matecrew_core::flow::Beep::Notification,
        4 => matecrew_core::flow::Beep::Badge,
        5 => matecrew_core::flow::Beep::Unknown,
        6 => matecrew_core::flow::Beep::Boot,
        _ => matecrew_core::flow::Beep::Key,
    };
    let bytes = serde_json::to_vec(beep.tones()).unwrap();
    let len = bytes.len() as i32;
    OUTPUT.set(bytes);
    len
}

/// A screen the terminal draws itself, as the page describes it.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum View {
    Boot { stage: u8 },
    Main {
        state: DeviceState,
        offline: bool,
    },
    Dashboard {
        data: DeviceScreen,
        offline: bool,
    },
    Connecting {
        ssid: String,
    },
    #[serde(rename_all = "camelCase")]
    Link {
        code: String,
        url: String,
        url_with_code: String,
    },
    Linked {
        office: String,
        name: String,
    },
    Error {
        title: String,
        detail: String,
    },
    /// A screen of the take flow, as an effect gave it.
    Flow {
        screen: Screen,
    },
}

/// An event for the flow, with what the page knows when it happens.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub event: Event,
    pub now_ms: u64,
    pub unix: Option<i64>,
    pub random: u64,
    /// To sign the link that claims an unknown badge.
    #[serde(default)]
    pub claim: Option<ClaimInput>,
}

/// The site, and the SHA-256 of the token in hex, as the page computes it.
#[derive(Deserialize)]
pub struct ClaimInput {
    pub site: String,
    pub key: String,
}

fn hex32(hex: &str) -> Option<[u8; 32]> {
    let mut out = [0u8; 32];
    if hex.len() != 64 {
        return None;
    }
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(2 * i..2 * i + 2)?, 16).ok()?;
    }
    Some(out)
}

pub fn draw(frame: &mut Frame, view: &View) {
    let _ = match view {
        View::Boot { stage } => ui::boot::render(frame, *stage),
        View::Main { state, offline } => ui::state_screen(frame, state, *offline),
        View::Dashboard { data, offline } => ui::dashboard_screen(frame, data, *offline),
        View::Connecting { ssid } => ui::connecting_screen(frame, ssid),
        View::Link {
            code,
            url,
            url_with_code,
        } => ui::link_screen(
            frame,
            &ui::LinkInfo {
                code,
                url,
                url_with_code,
                // The virtual terminal has no radio.
                bluetooth: "",
            },
        ),
        View::Linked { office, name } => ui::linked_screen(frame, office, name),
        View::Error { title, detail } => ui::error_screen(frame, title, detail),
        View::Flow { screen } => ui::flow_screen(frame, screen),
    };
}

thread_local! {
    static FRAME: RefCell<Frame> = RefCell::new(Frame::new());
    static FLOW: RefCell<Flow> = RefCell::new(Flow::new());
    static STATE: RefCell<Option<DeviceState>> = const { RefCell::new(None) };
    static APP: RefCell<Option<ui::engine::Runtime>> = const { RefCell::new(None) };
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
    let Some(view) = take_json::<View>(ptr, len) else {
        return -1;
    };
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
    let Some(state) = take_json::<DeviceState>(ptr, len) else {
        return -1;
    };
    ui::set_theme(ui::Theme::from_name(
        state.theme.as_deref().unwrap_or("flipper"),
    ));
    STATE.set(Some(state));
    0
}

/// # Safety
/// As for `render`.
#[no_mangle]
pub unsafe extern "C" fn handle(ptr: *mut u8, len: usize) -> i32 {
    let Some(input) = take_json::<Input>(ptr, len) else {
        return -1;
    };
    let key = input.claim.as_ref().and_then(|c| hex32(&c.key));
    let effects = STATE.with_borrow(|state| {
        let claim = match (&input.claim, &key, state) {
            (Some(c), Some(key), Some(state)) => Some(Claim {
                site: &c.site,
                device_id: &state.device.id,
                key,
            }),
            _ => None,
        };
        let cx = Context {
            now_ms: input.now_ms,
            unix: input.unix,
            state: state.as_ref(),
            random: input.random,
            claim,
        };
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
    KEYS.set(matecrew_core::hardware::TouchKeys::default());
    ui::notifications::reset();
}

/// # Safety
/// `ptr` is an allocation containing DUI1 bytecode, consumed by this call.
#[no_mangle]
pub unsafe extern "C" fn load_app(ptr: *mut u8, len: usize) -> i32 {
    let bytes = Vec::from_raw_parts(ptr, len, len);
    let Ok(scene) = ui::engine::Scene::from_bytecode(&bytes) else {
        return -1;
    };
    let Ok(runtime) = ui::engine::Runtime::new(scene) else {
        return -1;
    };
    APP.set(Some(runtime));
    0
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppTick {
    now_ms: u64,
    on_wake: bool,
}
#[derive(Deserialize)]
struct AppData {
    id: String,
    value: serde_json::Value,
}
#[derive(Deserialize)]
struct AppAction {
    action: String,
}
fn app_output(effects: Vec<ui::engine::Effect>) -> i32 {
    let json = serde_json::to_vec(&effects).unwrap_or_default();
    let len = json.len() as i32;
    OUTPUT.set(json);
    len
}
/// # Safety
/// Same JSON allocation convention as `render`.
#[no_mangle]
pub unsafe extern "C" fn app_advance(ptr: *mut u8, len: usize) -> i32 {
    let Some(tick) = take_json::<AppTick>(ptr, len) else {
        return -1;
    };
    APP.with_borrow_mut(|app| match app {
        Some(app) => app_output(app.advance(tick.now_ms, tick.on_wake)),
        None => -1,
    })
}
/// # Safety
/// Same JSON allocation convention as `render`. This is API data, never a screen layout.
#[no_mangle]
pub unsafe extern "C" fn app_update(ptr: *mut u8, len: usize) -> i32 {
    let Some(update) = take_json::<AppData>(ptr, len) else {
        return -1;
    };
    APP.with_borrow_mut(|app| match app {
        Some(app) => i32::from(app.update(&update.id, update.value)),
        None => -1,
    })
}
/// # Safety
/// Same JSON allocation convention as `render`.
#[no_mangle]
pub unsafe extern "C" fn app_action(ptr: *mut u8, len: usize) -> i32 {
    let Some(action) = take_json::<AppAction>(ptr, len) else {
        return -1;
    };
    APP.with_borrow_mut(|app| match app {
        Some(app) => app_output(app.handle(&action.action)),
        None => -1,
    })
}
#[no_mangle]
pub extern "C" fn app_render(scale: u32) -> i32 {
    APP.with_borrow(|app| match app {
        Some(app) => {
            FRAME.with_borrow_mut(|frame| {
                let scale = if scale == 0 { ui::app_scale(app.scene()) } else { scale };
                let _ = ui::render_app(frame, app, scale);
            });
            0
        }
        None => -1,
    })
}

#[no_mangle]
pub extern "C" fn app_press(x: i32, y: i32) -> i32 {
    APP.with_borrow_mut(|app| match app {
        Some(app) => app_output(app.press(ui::engine::Point::new(
            x * app.scene().width as i32 / 200,
            y * app.scene().height as i32 / 120,
        ))),
        None => -1,
    })
}

#[no_mangle]
pub extern "C" fn app_tick(now_ms: f64) -> i32 {
    let now = now_ms.max(0.0) as u64;
    let system = ui::notifications::tick(now);
    i32::from(APP.with_borrow_mut(|app| app.as_mut().is_some_and(|app| app.tick(now))) || system)
}
#[no_mangle]
pub extern "C" fn app_overlay_deadline() -> f64 {
    APP.with_borrow(|app| {
        [
            app.as_ref().and_then(|app| app.overlay_deadline()),
            ui::notifications::deadline(),
        ]
        .into_iter()
        .flatten()
        .min()
        .map_or(-1.0, |ms| ms as f64)
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Notification {
    message: String,
    duration_ms: u32,
    now_ms: u64,
}
/// # Safety
/// Consumes one JSON allocation from `alloc`. Rendering stays in the device engine.
#[no_mangle]
pub unsafe extern "C" fn system_notify(ptr: *mut u8, len: usize) -> i32 {
    let Some(notification) = take_json::<Notification>(ptr, len) else {
        return -1;
    };
    i32::from(ui::notifications::notify(
        &notification.message,
        notification.duration_ms,
        notification.now_ms,
    ))
}

/// # Safety
/// Same JSON allocation convention as `render`; restores host-managed API/local state caches.
#[no_mangle]
pub unsafe extern "C" fn app_restore(ptr: *mut u8, len: usize) -> i32 {
    let Some(cache) = take_json::<serde_json::Value>(ptr, len) else {
        return -1;
    };
    APP.with_borrow_mut(|app| match app {
        Some(app) => {
            app.restore(&cache);
            0
        }
        None => -1,
    })
}

#[no_mangle]
pub extern "C" fn app_cache() -> i32 {
    APP.with_borrow(|app| match app {
        Some(app) => {
            let json = serde_json::to_vec(app.data()).unwrap_or_default();
            let len = json.len() as i32;
            OUTPUT.set(json);
            len
        }
        None => -1,
    })
}

/// Missing image downloads resolved from the current application data.
#[no_mangle]
pub extern "C" fn app_images() -> i32 {
    APP.with_borrow(|app| match app {
        Some(app) => {
            let json = serde_json::to_vec(&app.image_requests()).unwrap_or_default();
            let len = json.len() as i32;
            OUTPUT.set(json);
            len
        }
        None => -1,
    })
}

/// # Safety
/// Both pointers are owned allocations from `alloc`, consumed by this call.
/// Request metadata is JSON; the image payload is raw PNG bytes, decoded in Rust.
#[no_mangle]
pub unsafe extern "C" fn app_image(
    request_ptr: *mut u8,
    request_len: usize,
    ptr: *mut u8,
    len: usize,
) -> i32 {
    let request = take_json::<ui::engine::image::ImageRequest>(request_ptr, request_len);
    let bytes = Vec::from_raw_parts(ptr, len, len);
    let Some(request) = request else { return -1 };
    APP.with_borrow_mut(|app| match app {
        Some(app) => app.update_image(&request, &bytes).map_or(-1, i32::from),
        None => -1,
    })
}

/// Host preview override; 0 = Flipper, 1 = macOS, 2 = dark.
#[no_mangle]
pub extern "C" fn set_theme(theme: u32) {
    let theme = match theme {
        1 => ui::Theme::Macos,
        2 => ui::Theme::Dark,
        3 => ui::Theme::Paper,
        _ => ui::Theme::Flipper,
    };
    ui::set_theme(theme);
    APP.with_borrow_mut(|app| {
        if let Some(app) = app {
            app.set_theme(theme);
        }
    });
}

/// # Safety
/// JSON allocation from `alloc`, consumed by this call. -2 means unbound input.
#[no_mangle]
pub unsafe extern "C" fn app_input(ptr: *mut u8, len: usize) -> i32 {
    let Some(input) = take_json::<String>(ptr, len) else {
        return -1;
    };
    APP.with_borrow_mut(|app| match app {
        Some(app) => app.input(&input).map_or(-2, app_output),
        None => -1,
    })
}

#[no_mangle]
pub extern "C" fn load_showcase() -> i32 {
    match ui::apps::showcase() {
        Ok(app) => {
            APP.set(Some(app));
            0
        }
        Err(_) => -1,
    }
}

/// # Safety
/// JSON platform metadata allocation from `alloc`, consumed by this call.
#[no_mangle]
pub unsafe extern "C" fn app_device(ptr: *mut u8, len: usize) -> i32 {
    let Some(info) = take_json::<serde_json::Value>(ptr, len) else {
        return -1;
    };
    let mut info = info;
    if let Some(unix) = info["unix"].as_i64() {
        info["clock"] = serde_json::json!(
            STATE.with_borrow(|state| ui::device_info::clock(state.as_ref(), unix))
        );
    }
    let info = ui::device_info::set(info);
    APP.with_borrow_mut(|app| match app {
        Some(app) => i32::from(app.update_device(info)),
        None => 1,
    })
}
