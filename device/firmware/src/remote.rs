//! The site's console: commands it sends to the terminal, and a mirror of
//! what the panel shows. Both run in their own threads while the terminal is
//! linked and online. The mirror uploads only while someone has the console
//! open (`live` in the commands' answer): 48 KB per screen otherwise spent on
//! the radio and the battery for nobody.

use anyhow::Result;
use matecrew_core::{
    contract::{normalize_uid, Command},
    flow::Event,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use crate::{
    api::{Api, Unauthorized},
    Input,
};

/// Long-polls the site for console commands and passes them on as inputs; tells the mirror
/// whether the console is open.
pub fn poll_commands(api: Api, inputs: Sender<Input>, mirror: Mirror) -> Result<()> {
    thread::Builder::new()
        .stack_size(10 * 1024)
        .spawn(move || loop {
            let reply = match api.commands() {
                Ok(reply) => reply,
                Err(e) => {
                    log::warn!("console commands: {e:#}");
                    // Unlinked on the site: a sync now finds out and links again,
                    // instead of at the next scheduled one.
                    if e.is::<Unauthorized>() && inputs.send(Input::Sync).is_err() {
                        return;
                    }
                    thread::sleep(Duration::from_secs(10));
                    continue;
                }
            };
            mirror.watched(reply.live);
            for command in reply.commands {
                log::info!("console: {command:?}");
                let input = match command {
                    Command::Key { side, .. } => Input::Flow(Event::Key { side }),
                    Command::Both { .. } => Input::Flow(Event::BothKeys),
                    Command::Badge { uid, .. } => match normalize_uid(&uid) {
                        Some(uid) => Input::Flow(Event::Badge { uid }),
                        None => continue,
                    },
                    Command::Sync { app: Some(app), .. } => Input::SelectApp(app),
                    Command::Sync { .. } => Input::Sync,
                    Command::Tap { x, y, .. } => Input::Tap(x, y),
                    Command::Restart { .. } => Input::Restart,
                    Command::ForgetWifi { .. } => Input::ForgetWifi,
                    Command::Unknown => continue,
                };
                if inputs.send(input).is_err() {
                    return;
                }
            }
        })?;
    Ok(())
}

/// The status bar's rows in a packed frame (56 px of 800 / 8 bytes): the clock and the arrows.
const STATUS_BYTES: usize = 56 * 800 / 8;
/// How often a change in the status bar alone is uploaded.
const STATUS_EVERY: Duration = Duration::from_secs(30);

/// Uploads each new frame while the console is open; when several pile up, only the latest
/// goes. Opening the console uploads the screen at once.
#[derive(Clone)]
pub struct Mirror {
    /// A new frame, or `None` to upload the latest again.
    frames: Sender<Option<Vec<u8>>>,
    live: Arc<AtomicBool>,
}

impl Mirror {
    pub fn start(api: Api) -> Result<Self> {
        let (frames, received) = mpsc::channel::<Option<Vec<u8>>>();
        let live = Arc::new(AtomicBool::new(false));
        let watched = live.clone();
        thread::Builder::new()
            .stack_size(10 * 1024)
            .spawn(move || {
                let mut latest: Option<Vec<u8>> = None;
                let mut sent = true;
                let mut uploaded: Option<Vec<u8>> = None;
                let mut status_uploaded: Option<Instant> = None;
                while let Ok(message) = received.recv() {
                    for message in std::iter::once(message).chain(received.try_iter()) {
                        if let Some(frame) = message {
                            latest = Some(frame);
                        }
                        sent = false;
                    }
                    let Some(frame) = latest.as_ref().filter(|_| !sent && watched.load(Ordering::Relaxed)) else {
                        continue;
                    };
                    // Uploading lights the status bar's network arrow, which changes the screen,
                    // which uploads again: a change in the status bar alone goes at most every
                    // STATUS_EVERY; the next one elsewhere carries it.
                    let status_only = uploaded.as_ref().is_some_and(|before| before[STATUS_BYTES..] == frame[STATUS_BYTES..]);
                    if status_only && status_uploaded.is_some_and(|at| at.elapsed() < STATUS_EVERY) {
                        continue;
                    }
                    match api.put_frame(frame) {
                        Ok(()) => {
                            sent = true;
                            uploaded = Some(frame.clone());
                            if status_only {
                                status_uploaded = Some(Instant::now());
                            }
                        }
                        Err(e) => log::warn!("screen mirror: {e:#}"),
                    }
                }
            })?;
        Ok(Self { frames, live })
    }

    pub fn send(&self, frame: &[u8]) {
        let _ = self.frames.send(Some(frame.to_vec()));
    }

    /// Whether someone has the console open; when they just opened it, the screen goes now.
    fn watched(&self, live: bool) {
        if live && !self.live.swap(true, Ordering::Relaxed) {
            let _ = self.frames.send(None);
        } else if !live {
            self.live.store(false, Ordering::Relaxed);
        }
    }
}
