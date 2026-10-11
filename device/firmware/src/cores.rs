//! Which of the ESP32-S3's two cores runs what. Wi-Fi and lwIP run on core 0, and so do the
//! threads that talk to the site. The screen loop (drawing, the panel) runs on core 1
//! (`CONFIG_ESP_MAIN_TASK_AFFINITY_CPU1`) with the keys and the piezo: the radio never holds a
//! key, a beep or a frame, and a site that does not answer never holds the screen.

use esp_idf_svc::hal::{
    cpu::Core,
    task::thread::{MallocCap, ThreadSpawnConfiguration},
};

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

/// Runs `spawn` with the threads it starts keeping their stack in PSRAM, on the same core. Internal
/// RAM is what Wi-Fi, Bluetooth and DMA run short of; PSRAM has megabytes. Only for threads that
/// never write the flash themselves: the cache, and their stack with it, is off meanwhile.
pub fn stacks_in_psram<T>(spawn: impl FnOnce() -> T) -> T {
    let before = ThreadSpawnConfiguration::get().unwrap_or_default();
    let mut external = ThreadSpawnConfiguration::get().unwrap_or_default();
    external.stack_alloc_caps = MallocCap::Spiram | MallocCap::Cap8bit;
    if let Err(e) = external.set() {
        log::warn!("cores: thread stacks stay in internal RAM: {e}");
    }
    let spawned = spawn();
    let _ = before.set();
    spawned
}
