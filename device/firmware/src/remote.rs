//! The site's console: commands it sends to the terminal, and a mirror of
//! what the panel shows. Both run in their own threads while the terminal is
//! linked and online.

use anyhow::Result;
use matecrew_core::{
    contract::{normalize_uid, Command},
    flow::Event,
};
use std::{
    sync::mpsc::{self, Sender},
    thread,
    time::Duration,
};

use crate::{
    api::{Api, Unauthorized},
    Input,
};

/// Long-polls the site for console commands and passes them on as inputs.
pub fn poll_commands(api: Api, inputs: Sender<Input>) -> Result<()> {
    thread::Builder::new().stack_size(10 * 1024).spawn(move || loop {
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
        for command in reply.commands {
            log::info!("console: {command:?}");
            let input = match command {
                Command::Key { side, .. } => Input::Flow(Event::Key { side }),
                Command::Badge { uid, .. } => match normalize_uid(&uid) {
                    Some(uid) => Input::Flow(Event::Badge { uid }),
                    None => continue,
                },
                Command::Sync { .. } => Input::Sync,
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

/// Uploads each new frame; when several pile up, only the latest goes.
pub struct Mirror(Sender<Vec<u8>>);

impl Mirror {
    pub fn start(api: Api) -> Result<Self> {
        let (frames, received) = mpsc::channel::<Vec<u8>>();
        thread::Builder::new().stack_size(10 * 1024).spawn(move || {
            while let Ok(mut frame) = received.recv() {
                while let Ok(newer) = received.try_recv() {
                    frame = newer;
                }
                if let Err(e) = api.put_frame(&frame) {
                    log::warn!("screen mirror: {e:#}");
                }
            }
        })?;
        Ok(Self(frames))
    }

    pub fn send(&self, frame: &[u8]) {
        let _ = self.0.send(frame.to_vec());
    }
}
