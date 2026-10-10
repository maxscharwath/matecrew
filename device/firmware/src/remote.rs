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
    time::Duration,
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
                while let Ok(message) = received.recv() {
                    for message in std::iter::once(message).chain(received.try_iter()) {
                        if let Some(frame) = message {
                            latest = Some(frame);
                            sent = false;
                        } else {
                            sent = false;
                        }
                    }
                    let Some(frame) = latest.as_ref().filter(|_| !sent && watched.load(Ordering::Relaxed)) else {
                        continue;
                    };
                    match api.put_frame(frame) {
                        Ok(()) => sent = true,
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
