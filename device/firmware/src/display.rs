//! The 7.5" panel behind the ePaper Driver Board for XIAO.
//!
//! Screens are drawn into a frame in memory, then handed to the panel's own
//! task: a refresh takes 1 to 2 s, and the screen loop goes back to the keys
//! at once instead of waiting for it. The task always shows the latest frame,
//! skipping those a newer one replaced while the panel was busy.
//!
//! Only what changed is sent: nothing when the frame is the same, a partial
//! refresh of the changed rectangle for an update, the controller's high
//! voltage off in between and deep sleep once nobody uses the terminal
//! (`rest`). A new screen (`frame::refresh`: over 6 % of the pixels turn)
//! drives its rectangle twice: once leaves the old screen showing through.
//! Nothing flashes while the terminal is used: only the first screen takes a
//! full refresh, and `clean`, called when the terminal is idle, once the
//! ghosting adds up (`frame::worn`), after FULL_EVERY partial refreshes or
//! FULL_AFTER.

use anyhow::Result;
use core::convert::Infallible;
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use esp_idf_svc::hal::{
    gpio::{AnyIOPin, Gpio1, Gpio2, Gpio3, Gpio4, Gpio7, Gpio9, PinDriver, Pull},
    spi::{config::Config, Dma, SpiDeviceDriver, SpiDriverConfig, SPI2},
    units::FromValueType,
};
use matecrew_ui::frame::{self, Frame};
use std::{
    collections::VecDeque,
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant},
};

use crate::epd::{Epd, CHUNK};

pub type Canvas = Frame;

const FULL_EVERY: u32 = 40;
const FULL_AFTER: Duration = Duration::from_secs(60 * 60);

/// What the screen loop asks of the panel's task.
enum Order {
    /// Show this frame; `drawn` is how long it took to draw, for the log.
    Show { bits: Vec<u8>, drawn: Duration },
    /// The panel shows this frame already, worn this much: kept from before a deep sleep
    /// (`sleep`). The next one is a partial refresh from it.
    Assume { bits: Vec<u8>, wear: Wear },
    /// Answers how worn the image is, once every order before it is done.
    Wear(Sender<Wear>),
    Clean,
    Rest,
    /// Answers once every order before it is done.
    Flush(Sender<()>),
}

/// How much the panel's image has worn since its last full refresh, kept through deep sleep: the
/// ghosting is cleared on schedule however often the terminal sleeps.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Wear {
    pub partials: u32,
    pub ghost: u32,
    /// Seconds awake since the last full refresh.
    pub age: u32,
}

/// The screen loop's side: draws frames and hands them to the panel's task.
pub struct Screen {
    orders: Sender<Order>,
    next: Frame,
    /// The last frame handed to the panel: what it shows or is about to.
    sent: Vec<u8>,
}

pub struct Pins {
    pub spi: SPI2<'static>,
    pub sck: Gpio7<'static>,
    pub mosi: Gpio9<'static>,
    pub cs: Gpio2<'static>,
    pub busy: Gpio3<'static>,
    pub dc: Gpio4<'static>,
    pub rst: Gpio1<'static>,
}

impl Screen {
    /// XIAO D-pins: RST D0, CS D1, BUSY D2, DC D3, SCK D8, MOSI D10. No MISO:
    /// D9 is the right touch key. The panel's task runs on the core this is called from.
    pub fn new(pins: Pins) -> Result<Self> {
        let spi = SpiDeviceDriver::new_single(
            pins.spi,
            pins.sck,
            pins.mosi,
            Option::<AnyIOPin>::None,
            Some(pins.cs),
            &SpiDriverConfig::new().dma(Dma::Auto(CHUNK)),
            // As GxEPD2 drives this panel: an 800 x 480 frame takes about 40 ms.
            &Config::new().baudrate(10u32.MHz().into()),
        )?;
        let epd = Epd::new(
            spi,
            PinDriver::input(pins.busy, Pull::Floating)?,
            PinDriver::output(pins.dc)?,
            PinDriver::output(pins.rst)?,
        );
        let (orders, queue) = mpsc::channel();
        let mut panel = Panel {
            epd,
            shown: vec![0; frame::BYTES],
            partials: 0,
            ghost: 0,
            last_full: None,
            aged: Duration::ZERO,
        };
        thread::Builder::new().stack_size(8 * 1024).spawn(move || panel.run(queue))?;
        Ok(Self { orders, next: Frame::new(), sent: vec![0; frame::BYTES] })
    }

    /// Draws a screen from `matecrew_ui` and hands it to the panel: a partial refresh of what
    /// changed. Returns once it is drawn, before the panel shows it.
    pub fn show(&mut self, draw: impl FnOnce(&mut Canvas) -> Result<(), Infallible>) -> Result<()> {
        let started = Instant::now();
        let _ = self.next.clear(BinaryColor::Off);
        let _ = draw(&mut self.next);
        let drawn = started.elapsed();
        if self.next.bits != self.sent {
            self.sent.copy_from_slice(&self.next.bits);
            // Every screen, setup and linking included, for whoever watches (`viewers`).
            crate::viewers::screen(&self.sent);
            self.order(Order::Show { bits: self.next.bits.clone(), drawn });
        }
        Ok(())
    }

    /// After a deep sleep: draws again the screen the panel kept, without refreshing it, so the
    /// next one is a partial refresh from it rather than a flash. Only if it is the same frame
    /// (`digest`); false otherwise, and the next screen takes the full refresh.
    pub fn assume(&mut self, draw: impl FnOnce(&mut Canvas) -> Result<(), Infallible>, digest: u32, wear: Wear) -> bool {
        let _ = self.next.clear(BinaryColor::Off);
        let _ = draw(&mut self.next);
        if crate::sleep::digest(&self.next.bits) != digest {
            return false;
        }
        self.sent.copy_from_slice(&self.next.bits);
        crate::viewers::screen(&self.sent);
        self.order(Order::Assume { bits: self.next.bits.clone(), wear });
        true
    }

    /// How worn the image is, once the panel shows what was handed to it: before a deep sleep.
    pub fn wear(&self) -> Wear {
        let (done, wait) = mpsc::channel();
        self.order(Order::Wear(done));
        wait.recv().unwrap_or_default()
    }

    /// The last frame handed to the panel.
    pub fn sent(&self) -> &[u8] {
        &self.sent
    }

    /// Draws the idle screen.
    pub fn show_main(&mut self, draw: impl FnOnce(&mut Canvas) -> Result<(), Infallible>) -> Result<()> {
        self.show(draw)
    }

    /// Portable TSX bytecode apps use the same physical panel and changed-region refresh path.
    pub fn show_app(&mut self, app: &matecrew_ui::engine::Runtime) -> Result<()> {
        self.show(|canvas| matecrew_ui::render_app(canvas, app, matecrew_ui::app_scale(app.scene())))
    }

    /// Puts the controller in deep sleep, for when nobody uses the terminal. The next refresh
    /// wakes it, about 350 ms slower than one right after another.
    pub fn rest(&mut self) -> Result<()> {
        self.order(Order::Rest);
        Ok(())
    }

    /// Clears the ghosting with the fast full refresh (a flash) when it is due. For when nobody
    /// is using the terminal.
    pub fn clean(&mut self) -> Result<()> {
        self.order(Order::Clean);
        Ok(())
    }

    /// Waits until the panel shows what was handed to it: before a restart.
    pub fn flush(&self) {
        let (done, wait) = mpsc::channel();
        if self.orders.send(Order::Flush(done)).is_ok() {
            let _ = wait.recv();
        }
    }

    fn order(&self, order: Order) {
        if self.orders.send(order).is_err() {
            log::error!("display: the panel's task stopped");
        }
    }
}

/// The panel's task: the controller and what the panel shows.
struct Panel {
    epd: Epd,
    /// What the panel shows.
    shown: Vec<u8>,
    partials: u32,
    /// Pixels partial refreshes turned since the last full one: their ghosting adds up.
    ghost: u32,
    last_full: Option<Instant>,
    /// Awake time since the last full refresh before the last deep sleep.
    aged: Duration,
}

impl Panel {
    fn run(&mut self, queue: Receiver<Order>) {
        let mut waiting = VecDeque::new();
        while let Ok(order) = queue.recv() {
            waiting.push_back(order);
            waiting.extend(queue.try_iter());
            while let Some(order) = waiting.pop_front() {
                let outdated = matches!(order, Order::Show { .. })
                    && waiting.iter().any(|o| matches!(o, Order::Show { .. }));
                if outdated {
                    log::info!("display: a newer screen replaced one not shown yet");
                    continue;
                }
                if let Err(e) = self.carry_out(order) {
                    log::error!("display: {e:#}");
                }
                // What came in meanwhile is judged with the rest.
                waiting.extend(queue.try_iter());
            }
        }
    }

    fn carry_out(&mut self, order: Order) -> Result<()> {
        match order {
            Order::Show { bits, drawn } => self.present(&bits, false, drawn),
            Order::Assume { bits, wear } => {
                self.shown = bits;
                self.partials = wear.partials;
                self.ghost = wear.ghost;
                self.last_full = Some(Instant::now());
                self.aged = Duration::from_secs(wear.age.into());
                Ok(())
            }
            Order::Wear(answer) => {
                let age = self.last_full.map_or(Duration::ZERO, |at| at.elapsed() + self.aged);
                let _ = answer.send(Wear { partials: self.partials, ghost: self.ghost, age: age.as_secs() as u32 });
                Ok(())
            }
            Order::Clean => {
                let due = self.partials >= FULL_EVERY
                    || frame::worn(self.ghost)
                    || self.last_full.is_some_and(|at| at.elapsed() + self.aged > FULL_AFTER);
                if due {
                    let shown = self.shown.clone();
                    self.present(&shown, true, Duration::ZERO)?;
                }
                Ok(())
            }
            Order::Rest => {
                if self.epd.is_awake() {
                    self.epd.sleep()?;
                }
                Ok(())
            }
            Order::Flush(done) => {
                let _ = done.send(());
                Ok(())
            }
        }
    }

    fn present(&mut self, bits: &[u8], full: bool, drawn: Duration) -> Result<()> {
        let started = Instant::now();
        let refresh = frame::refresh(&self.shown, bits);
        if self.last_full.is_none() || full {
            // The first refresh takes the long waveform: nobody knows what the panel showed before.
            let fast = self.last_full.is_some();
            self.epd.full(bits, fast)?;
            self.partials = 0;
            self.ghost = 0;
            self.last_full = Some(Instant::now());
            self.aged = Duration::ZERO;
            log::info!(
                "display: {} refresh in {} ms",
                if fast { "fast" } else { "full" },
                started.elapsed().as_millis()
            );
        } else if let frame::Refresh::Partial { window, turned, twice } = refresh {
            self.epd.partial(window, &self.shown, bits, if twice { 2 } else { 1 })?;
            self.partials += 1;
            self.ghost += turned;
            log::info!(
                "display: {} x {} at {},{} in {} ms, drawn in {} ms",
                window.width,
                window.height,
                window.x,
                window.y,
                started.elapsed().as_millis(),
                drawn.as_millis()
            );
        } else {
            return Ok(());
        }
        self.shown.copy_from_slice(bits);
        Ok(())
    }
}
