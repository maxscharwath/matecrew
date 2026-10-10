//! The terminal's start, shared by the physical panel and the Wasm host: a live log of what
//! the system does, each line under way, done or failed, under a progress bar. Lines are
//! message keys with their parameters; the boot screen words them in the office's language
//! (`apps/system/messages.ts`).
use crate::{app_scale, engine, Theme};
use embedded_graphics::{pixelcolor::BinaryColor, prelude::*};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// Lines the screen shows: the latest ones.
const SHOWN: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Run,
    Done,
    Fail,
}

/// A line: the message key (`"wifiJoined"`), its parameters, and how the step went.
#[derive(Clone, Debug, PartialEq)]
struct Line {
    key: &'static str,
    params: Map<String, Value>,
    step: Step,
}

/// What the terminal did so far while starting, as the boot screen lists it.
#[derive(Clone, Debug, Default)]
pub struct BootLog {
    lines: Vec<Line>,
    /// Steps a start goes through, for the progress bar.
    total: usize,
}

/// Message parameters: `[("ssid", "Office")]`.
pub type Params<'a> = &'a [(&'a str, &'a str)];

fn params(params: Params) -> Map<String, Value> {
    params.iter().map(|(name, value)| ((*name).to_owned(), json!(value))).collect()
}

impl BootLog {
    pub fn new(total: usize) -> Self {
        Self { lines: Vec::new(), total }
    }

    /// A step starts: `start("wifiJoining", &[("ssid", "Office")])`.
    pub fn start(&mut self, key: &'static str, with: Params) {
        self.lines.push(Line { key, params: params(with), step: Step::Run });
    }

    /// The step under way went well, and says how: `done("wifiJoined", &[…])`.
    pub fn done(&mut self, key: &'static str, with: Params) {
        self.finish(Line { key, params: params(with), step: Step::Done });
    }

    /// The step under way failed; the start goes on without it.
    pub fn fail(&mut self, key: &'static str, with: Params) {
        self.finish(Line { key, params: params(with), step: Step::Fail });
    }

    fn finish(&mut self, line: Line) {
        match self.lines.last_mut() {
            Some(last) if last.step == Step::Run => *last = line,
            _ => self.lines.push(line),
        }
    }

    fn finished(&self) -> usize {
        self.lines.iter().filter(|line| line.step != Step::Run).count()
    }

    pub fn render<D: DrawTarget<Color = BinaryColor>>(&self, target: &mut D) -> Result<(), D::Error> {
        static SCENE: OnceLock<engine::Scene> = OnceLock::new();
        let scene = SCENE.get_or_init(|| {
            engine::Scene::from_bytecode(include_bytes!("../../dist/system/boot.dui")).expect("boot screen")
        });
        let total = self.total.max(1);
        let finished = self.finished().min(total);
        let lines: Vec<_> = self.lines[self.lines.len().saturating_sub(SHOWN)..]
            .iter()
            .map(|line| {
                let state = match line.step {
                    Step::Run => "run",
                    Step::Done => "done",
                    Step::Fail => "fail",
                };
                json!({"key": line.key, "params": line.params, "state": state})
            })
            .collect();
        let data = json!({
            "boot": {
                "title": "matécrew",
                "progress": finished * 100 / total,
                "lines": lines,
                "step": format!("{finished:02} / {total:02}"),
            },
            "$device": {"locale": crate::locale()},
        });
        scene.render_with_theme(target, &data, app_scale(scene), Theme::Paper)
    }
}

/// The start as four stages, for hosts that only know a stage number (the site's virtual
/// terminal, the simulator): the log a terminal shows at each.
pub fn render<D: DrawTarget<Color = BinaryColor>>(target: &mut D, stage: u8) -> Result<(), D::Error> {
    let mut log = BootLog::new(6);
    log.start("screen", &[]);
    log.done("screenReady", &[]);
    log.start("reader", &[]);
    log.done("readerReady", &[("version", "1.6")]);
    if stage >= 1 {
        log.start("wifiJoining", &[("ssid", "Wi-Fi")]);
    }
    if stage >= 2 {
        log.done("wifiJoinedQuiet", &[("ssid", "Wi-Fi")]);
        log.start("site", &[]);
        log.done("site", &[]);
        log.start("apps", &[]);
    }
    if stage >= 3 {
        log.done("appsLoaded", &[]);
        log.start("ready", &[]);
        log.done("allReady", &[]);
    }
    log.render(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_step_runs_then_ends_on_the_same_line() {
        let mut log = BootLog::new(3);
        log.start("wifiJoining", &[("ssid", "Office")]);
        assert_eq!(log.finished(), 0);
        log.done("wifiJoined", &[("ssid", "Office"), ("rssi", "-62")]);
        log.start("site", &[]);
        log.fail("wifiOffline", &[]);
        assert_eq!(log.lines.len(), 2);
        assert_eq!(log.lines[0].params["rssi"], "-62");
        assert_eq!(log.lines[1].step, Step::Fail);
        assert_eq!(log.finished(), 2);
    }
}
