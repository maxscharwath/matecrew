//! What the terminal decides without touching hardware: the site's API shapes,
//! the queue of takes, PN532 frames and the serial console commands. Runs on
//! the device and is tested on the Mac (`just test`).

pub mod claim;
pub mod console;
pub mod contract;
pub mod flow;
pub mod hardware;
pub mod link;
pub mod pn532;
pub mod power;
pub mod queue;
pub mod time;
