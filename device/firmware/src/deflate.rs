//! Raw deflate (no zlib header) with the ESP32-S3's ROM: miniz's `tdefl`, as ESP-IDF's
//! `esp_rom/include/miniz.h` declares it, built with `TDEFL_LESS_MEMORY`. No code in the image;
//! its state is allocated once, in PSRAM, never on a stack.

use core::{
    ffi::{c_int, c_void},
    ptr,
};
use esp_idf_svc::sys::{heap_caps_free, heap_caps_malloc, MALLOC_CAP_8BIT, MALLOC_CAP_SPIRAM};

/// `sizeof(tdefl_compressor)` in the ROM is 167 744 bytes; rounded up, tdefl only writes inside.
const STATE_BYTES: usize = 192 * 1024;
/// As zlib's level 6: lazy parsing, 128 probes per search. As small as level 9 on the panel's
/// screens, for less time.
const FLAGS: c_int = 128;
const TDEFL_STATUS_OKAY: c_int = 0;
const TDEFL_STATUS_DONE: c_int = 1;
const TDEFL_FINISH: c_int = 4;

extern "C" {
    // In the ROM (components/esp_rom/esp32s3/ld/esp32s3.rom.ld).
    fn tdefl_init(d: *mut c_void, put_buf: *const c_void, put_user: *mut c_void, flags: c_int) -> c_int;
    fn tdefl_compress(
        d: *mut c_void,
        in_buf: *const c_void,
        in_size: *mut usize,
        out_buf: *mut c_void,
        out_size: *mut usize,
        flush: c_int,
    ) -> c_int;
}

pub struct Deflater(*mut c_void);

// SAFETY: the state is only used through `&mut self`.
unsafe impl Send for Deflater {}

impl Deflater {
    /// None when PSRAM has no room for the state.
    pub fn new() -> Option<Self> {
        // SAFETY: plain allocation; freed in `Drop`.
        let state = unsafe { heap_caps_malloc(STATE_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) };
        (!state.is_null()).then_some(Self(state))
    }

    /// `input` deflated, or None when it would not come out smaller.
    pub fn deflate(&mut self, input: &[u8]) -> Option<Vec<u8>> {
        let mut out = vec![0u8; input.len()];
        let (mut read, mut written) = (input.len(), out.len());
        // SAFETY: the state is STATE_BYTES long, the buffers as long as said; tdefl keeps no
        // pointer to them past the call (no callback, everything finished at once).
        let status = unsafe {
            if tdefl_init(self.0, ptr::null(), ptr::null_mut(), FLAGS) != TDEFL_STATUS_OKAY {
                return None;
            }
            tdefl_compress(
                self.0,
                input.as_ptr().cast(),
                &mut read,
                out.as_mut_ptr().cast(),
                &mut written,
                TDEFL_FINISH,
            )
        };
        // Not DONE: the output did not fit in the input's size, so it is not worth it.
        (status == TDEFL_STATUS_DONE && read == input.len()).then(|| {
            out.truncate(written);
            out
        })
    }
}

impl Drop for Deflater {
    fn drop(&mut self) {
        // SAFETY: allocated by heap_caps_malloc in `new`.
        unsafe { heap_caps_free(self.0) };
    }
}
