//! Which of the ESP32-S3's two cores runs what. Wi-Fi and lwIP run on core 0, and so do the
//! threads that talk to the site. The screen loop (drawing, the panel) runs on core 1
//! (`CONFIG_ESP_MAIN_TASK_AFFINITY_CPU1`) with the keys and the piezo: the radio never holds a
//! key, a beep or a frame, and a site that does not answer never holds the screen.

use esp_idf_svc::hal::{cpu::Core, task::thread::ThreadSpawnConfiguration};

/// Runs `spawn` with the threads it starts pinned to `core`, then back to no pinning.
pub fn on<T>(core: Core, spawn: impl FnOnce() -> T) -> T {
    let pinned = ThreadSpawnConfiguration { pin_to_core: Some(core), ..Default::default() };
    if let Err(e) = pinned.set() {
        log::warn!("cores: threads not pinned to {core:?}: {e}");
    }
    let spawned = spawn();
    let _ = ThreadSpawnConfiguration::default().set();
    spawned
}
