//! How full the terminal's memories are, for the about page (`$device.memory`): internal RAM,
//! PSRAM, the firmware in its app slot, and the NVS stores (settings and cache). Bytes, used and
//! total.

use esp_idf_svc::sys::{
    esp_image_get_metadata, esp_image_metadata_t, esp_ota_get_running_partition, esp_partition_pos_t,
    heap_caps_get_free_size, heap_caps_get_total_size, nvs_get_stats, nvs_stats_t, ESP_OK, MALLOC_CAP_8BIT,
    MALLOC_CAP_INTERNAL, MALLOC_CAP_SPIRAM,
};
use serde_json::{json, Value};
use std::sync::OnceLock;

/// An NVS entry: what a key, a small value or a slice of a blob takes.
const NVS_ENTRY: usize = 32;

fn heap(caps: u32) -> Value {
    // SAFETY: ESP-IDF heap queries take capability flags and borrow no memory.
    let (total, free) = unsafe { (heap_caps_get_total_size(caps), heap_caps_get_free_size(caps)) };
    json!({"used": total.saturating_sub(free), "total": total})
}

/// The running firmware's size and its slot's: read once, they do not change until a restart.
fn firmware() -> Value {
    static FIRMWARE: OnceLock<Value> = OnceLock::new();
    FIRMWARE
        .get_or_init(|| {
            // SAFETY: the running partition is a static table entry; the metadata is written by
            // ESP-IDF into a zeroed struct it owns for the call.
            unsafe {
                let slot = esp_ota_get_running_partition();
                if slot.is_null() {
                    return Value::Null;
                }
                let position = esp_partition_pos_t { offset: (*slot).address, size: (*slot).size };
                let mut metadata: esp_image_metadata_t = core::mem::zeroed();
                let used = (esp_image_get_metadata(&position, &mut metadata) == ESP_OK).then_some(metadata.image_len);
                json!({"used": used, "total": (*slot).size})
            }
        })
        .clone()
}

/// The settings partition, and the cache's own figures (`cache.rs`): what its entries take, not
/// NVS's bookkeeping.
fn storage() -> Value {
    let mut stats = nvs_stats_t { used_entries: 0, free_entries: 0, available_entries: 0, total_entries: 0, namespace_count: 0 };
    // SAFETY: a NUL-terminated partition name and a stats struct the call fills.
    let (mut used, mut total) = match unsafe { nvs_get_stats(c"nvs".as_ptr(), &mut stats) } {
        ESP_OK => (stats.used_entries * NVS_ENTRY, stats.total_entries * NVS_ENTRY),
        _ => (0, 0),
    };
    if let Some(cache) = crate::cache::usage() {
        used += cache.used;
        total += cache.total.unwrap_or(cache.used);
    }
    json!({"used": used, "total": total})
}

pub fn json() -> Value {
    json!({
        "ram": heap(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
        "psram": heap(MALLOC_CAP_SPIRAM),
        "firmware": firmware(),
        "storage": storage(),
    })
}
