//! The emulator's running app: touch keys go through the board's edge detector, sampled like
//! the firmware samples GPIO 5 and 8, and beeps are the board's own tone programs.
use crate::{base64, OUTPUT, SIZE};
use device_engine::{frame::Frame, Effect, Point, Runtime, Scene};
use serde::Deserialize;
use serde_json::Value;
use std::cell::RefCell;

pub struct Session {
    pub runtime: Runtime,
    keys: device_board::Presses,
    panel: [u32; 2],
    /// Binding roots a host sets directly, such as `view` for host-driven screens.
    data: Value,
}
impl Session {
    pub fn new(bytecode: &[u8]) -> Result<Self, String> {
        let scene =
            Scene::from_bytecode(bytecode).map_err(|error| format!("invalid bytecode: {error}"))?;
        let runtime = Runtime::new(scene).map_err(|error| format!("invalid scene: {error}"))?;
        Ok(Self {
            runtime,
            keys: Default::default(),
            panel: device_board::PANEL,
            data: Value::Null,
        })
    }
    /// Sample the key pins at `now_ms`, as the firmware does every `KEY_POLL_MS`: a key is the
    /// matching hardware input once the other could no longer join it; both keys together
    /// belong to the host (the terminal's about page), so they come out as `emit("both")`.
    pub fn gpio(&mut self, left: bool, right: bool, now_ms: u64) -> Vec<Effect> {
        match self.keys.sample(left, right, now_ms) {
            Some(device_board::Press::Left) => self.runtime.input("left").unwrap_or_default(),
            Some(device_board::Press::Right) => self.runtime.input("right").unwrap_or_default(),
            Some(device_board::Press::Both) => vec![Effect::Emit { name: "both".into() }],
            None => Vec::new(),
        }
    }
    /// Integer scale that fits the app on the panel, as the firmware fits it.
    pub fn scale(&self) -> u32 {
        let scene = self.runtime.scene();
        (self.panel[0] / scene.width).min(self.panel[1] / scene.height).max(1)
    }
    /// A tap in panel pixels.
    pub fn press(&mut self, x: i32, y: i32) -> Vec<Effect> {
        let scale = self.scale() as i32;
        self.runtime.press(Point::new(x / scale, y / scale))
    }
    pub fn render(&self) -> Frame {
        let [width, height] = self.panel;
        let mut frame = Frame::new(width, height).expect("panel size");
        let mut data = self.runtime.data().clone();
        if let (Some(target), Some(extra)) = (data.as_object_mut(), self.data.as_object()) {
            for (key, value) in extra {
                target.insert(key.clone(), value.clone());
            }
        }
        let _ = self.runtime.scene().render(&mut frame, &data, self.scale());
        frame
    }
}

thread_local! {
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
}

fn output(bytes: Vec<u8>) -> i32 {
    let len = bytes.len() as i32;
    OUTPUT.set(bytes);
    len
}
fn fail(message: impl Into<String>) -> i32 {
    OUTPUT.set(message.into().into_bytes());
    -1
}
fn effects(effects: Vec<Effect>) -> i32 {
    output(serde_json::to_vec(&effects).unwrap_or_default())
}
fn with_session(run: impl FnOnce(&mut Session) -> i32) -> i32 {
    SESSION.with_borrow_mut(|session| match session {
        Some(session) => run(session),
        None => fail("no app loaded"),
    })
}
unsafe fn take(ptr: *mut u8, len: usize) -> Vec<u8> {
    Vec::from_raw_parts(ptr, len, len)
}
unsafe fn take_json<T: for<'de> Deserialize<'de>>(ptr: *mut u8, len: usize) -> Result<T, String> {
    serde_json::from_slice(&take(ptr, len)).map_err(|error| error.to_string())
}

/// # Safety
/// `ptr` comes from `alloc(len)` and holds DUI bytecode; it is consumed.
#[no_mangle]
pub unsafe extern "C" fn session_load(ptr: *mut u8, len: usize) -> i32 {
    match Session::new(&take(ptr, len)) {
        Ok(session) => {
            SESSION.set(Some(session));
            0
        }
        Err(message) => fail(message),
    }
}

/// # Safety
/// JSON in an `alloc` buffer, consumed: the offline-cache shape (`Runtime::restore`).
#[no_mangle]
pub unsafe extern "C" fn session_restore(ptr: *mut u8, len: usize) -> i32 {
    match take_json::<Value>(ptr, len) {
        Ok(cache) => with_session(|session| {
            session.runtime.restore(&cache);
            0
        }),
        Err(message) => fail(message),
    }
}

/// # Safety
/// JSON object in an `alloc` buffer, consumed: `$device` metadata.
#[no_mangle]
pub unsafe extern "C" fn session_device(ptr: *mut u8, len: usize) -> i32 {
    match take_json::<Value>(ptr, len) {
        Ok(info) => with_session(|session| i32::from(session.runtime.update_device(info))),
        Err(message) => fail(message),
    }
}

#[derive(Deserialize)]
struct Update {
    id: String,
    value: Value,
}
/// # Safety
/// JSON `{id, value}` in an `alloc` buffer, consumed: a resource's fetched data.
#[no_mangle]
pub unsafe extern "C" fn session_update(ptr: *mut u8, len: usize) -> i32 {
    match take_json::<Update>(ptr, len) {
        Ok(update) => {
            with_session(|session| i32::from(session.runtime.update(&update.id, update.value)))
        }
        Err(message) => fail(message),
    }
}

/// Sample GPIO 5 and 8 at `now_ms`; returns the effects' JSON length.
#[no_mangle]
pub extern "C" fn session_gpio(left: u32, right: u32, now_ms: f64) -> i32 {
    with_session(|session| effects(session.gpio(left != 0, right != 0, now_ms.max(0.0) as u64)))
}

/// A tap in panel pixels; returns the effects' JSON length.
#[no_mangle]
pub extern "C" fn session_press(x: i32, y: i32) -> i32 {
    with_session(|session| effects(session.press(x, y)))
}

/// # Safety
/// JSON object in an `alloc` buffer, consumed: binding roots drawn over the app's data.
#[no_mangle]
pub unsafe extern "C" fn session_data(ptr: *mut u8, len: usize) -> i32 {
    match take_json::<Value>(ptr, len) {
        Ok(data) => with_session(|session| {
            session.data = data;
            0
        }),
        Err(message) => fail(message),
    }
}

/// # Safety
/// UTF-8 input name (`badge`, `left`…) in an `alloc` buffer, consumed. Returns the effects'
/// JSON length; `null` when no control of the app is bound to that input.
#[no_mangle]
pub unsafe extern "C" fn session_input(ptr: *mut u8, len: usize) -> i32 {
    let name = String::from_utf8_lossy(&take(ptr, len)).into_owned();
    with_session(|session| match session.runtime.input(&name) {
        Some(found) => effects(found),
        None => output(b"null".to_vec()),
    })
}

/// # Safety
/// UTF-8 action id in an `alloc` buffer, consumed.
#[no_mangle]
pub unsafe extern "C" fn session_action(ptr: *mut u8, len: usize) -> i32 {
    let id = String::from_utf8_lossy(&take(ptr, len)).into_owned();
    with_session(|session| effects(session.runtime.handle(&id)))
}

/// Advance to `now_ms` on the monotonic clock: expire toasts and return the fetches now due.
#[no_mangle]
pub extern "C" fn session_tick(now_ms: f64) -> i32 {
    with_session(|session| {
        session.runtime.tick(now_ms as u64);
        effects(session.runtime.advance(now_ms as u64, false))
    })
}

#[no_mangle]
pub extern "C" fn session_render() -> i32 {
    with_session(|session| {
        SIZE.set(session.panel);
        output(session.render().bits)
    })
}

/// The app's data (resources, local state, navigation, images, overlays) as JSON.
#[no_mangle]
pub extern "C" fn session_cache() -> i32 {
    with_session(|session| output(serde_json::to_vec(session.runtime.data()).unwrap_or_default()))
}

/// Web images the current screen still needs, as JSON `[{src, width, height, cover}]`.
#[no_mangle]
pub extern "C" fn session_images() -> i32 {
    with_session(|session| {
        output(serde_json::to_vec(&session.runtime.image_requests()).unwrap_or_default())
    })
}

#[derive(Deserialize)]
struct Image {
    src: String,
    png: String,
}
/// # Safety
/// JSON `{src, png: base64}` in an `alloc` buffer, consumed. Returns 1 when the image changed.
#[no_mangle]
pub unsafe extern "C" fn session_image(ptr: *mut u8, len: usize) -> i32 {
    let image = match take_json::<Image>(ptr, len) {
        Ok(image) => image,
        Err(message) => return fail(message),
    };
    let Some(bytes) = base64(&image.png) else {
        return fail("invalid base64");
    };
    with_session(|session| {
        let request = session
            .runtime
            .image_requests()
            .into_iter()
            .find(|request| request.src == image.src);
        match request.map(|request| session.runtime.update_image(&request, &bytes)) {
            None => 0,
            Some(Ok(changed)) => i32::from(changed),
            Some(Err(message)) => fail(message),
        }
    })
}

/// The board's tone program for `key`, `success`, `error` or `notification`, as JSON `[[hz, ms]]`.
///
/// # Safety
/// UTF-8 tone name in an `alloc` buffer, consumed.
#[no_mangle]
pub unsafe extern "C" fn tone(ptr: *mut u8, len: usize) -> i32 {
    let name = String::from_utf8_lossy(&take(ptr, len)).into_owned();
    match serde_json::from_value::<device_board::Tone>(Value::String(name)) {
        Ok(tone) => output(serde_json::to_vec(tone.program()).unwrap_or_default()),
        Err(error) => fail(error.to_string()),
    }
}

/// The board's wiring as JSON `[{pad, gpio, function, signal}]`.
#[no_mangle]
pub extern "C" fn pins() -> i32 {
    output(serde_json::to_vec(device_board::PINS).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    const APP: &[u8] = include_bytes!("../../engine/tests/fixtures/app.dui");

    #[test]
    fn touch_keys_fire_once_per_press_like_the_firmware() {
        let mut session = Session::new(APP).unwrap();
        let idle = session.render().bits;
        // The left key is bound to "Prendre": one effect once the right key could no longer
        // join it, none while held.
        assert!(session.gpio(true, false, 0).is_empty());
        let take = vec![Effect::Emit { name: "take".into() }];
        assert_eq!(session.gpio(true, false, device_board::CHORD_MS), take);
        assert!(session.gpio(true, false, 400).is_empty());
        assert!(session.gpio(false, false, 420).is_empty());
        assert_eq!(session.render().bits, idle);
        // Both keys are the host's: the about page.
        assert!(session.gpio(false, true, 1000).is_empty());
        assert_eq!(session.gpio(true, true, 1040), vec![Effect::Emit { name: "both".into() }]);
        assert!(session.gpio(false, false, 1060).is_empty());
        // The 800 × 480 app fills the panel at 1×: a tap on the same key tab.
        let effects = session.press(130, 452);
        assert_eq!(effects, vec![Effect::Emit { name: "take".into() }]);
    }
}
