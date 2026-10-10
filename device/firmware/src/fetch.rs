//! What the screens fetch while someone uses the terminal, on a thread of its own: an app's data
//! and images, and the badge holder's account ("Mon compte") with its purchases. A site that does
//! not answer never holds the keys. Each result comes back to the main loop as an input, and the
//! screen shows it then.

use anyhow::Result;
use matecrew_core::{
    contract::{Account, AccountRequest, CancelPurchaseRequest, CancelPurchaseResponse},
    flow::{Cause, Failure},
};
use matecrew_ui::engine::image::ImageRequest;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::mpsc::{self, Sender},
    thread,
    time::{Duration, Instant},
};

use crate::{
    api::{Api, Status, Unauthorized, Unreachable},
    Input,
};

/// A request that failed is not sent again before this: the site is likely down.
const RETRY_AFTER: Duration = Duration::from_secs(30);

pub enum Job {
    Data { id: String, path: String },
    Image(ImageRequest),
    Account { uid: String },
    CancelPurchase { uid: String, id: String },
}

impl Job {
    /// What makes two app requests the same; an account is always asked for again.
    fn key(&self) -> Option<&str> {
        match self {
            Job::Data { path, .. } => Some(path),
            Job::Image(request) => Some(&request.src),
            Job::Account { .. } | Job::CancelPurchase { .. } => None,
        }
    }
}

pub enum Fetched {
    Data { id: String, path: String, value: Result<Value> },
    Image { request: ImageRequest, bytes: Result<Vec<u8>> },
    /// The account, or what the screen says went wrong (logged here).
    Account(Result<Account, Failure>),
    Cancelled(Result<CancelPurchaseResponse, Failure>),
}

impl Fetched {
    fn key(&self) -> Option<&str> {
        match self {
            Fetched::Data { path, .. } => Some(path),
            Fetched::Image { request, .. } => Some(&request.src),
            Fetched::Account(_) | Fetched::Cancelled(_) => None,
        }
    }

    fn failed(&self) -> bool {
        match self {
            Fetched::Data { value, .. } => value.is_err(),
            Fetched::Image { bytes, .. } => bytes.is_err(),
            Fetched::Account(reply) => reply.is_err(),
            Fetched::Cancelled(reply) => reply.is_err(),
        }
    }
}

/// What the screen says about a request to the site that failed (`flow::Failure`), with the
/// error in the log.
fn failure(what: &str, error: &anyhow::Error) -> Failure {
    log::warn!("{what}: {error:#}");
    if let Some(status) = error.downcast_ref::<Status>() {
        return match (status.status, status.error.as_deref()) {
            (404, Some("unknown_badge")) => Failure::UnknownBadge,
            (status, _) => Failure::Site { status },
        };
    }
    if let Some(Unreachable(cause)) = error.downcast_ref::<Unreachable>() {
        return Failure::Offline { cause: *cause };
    }
    if error.is::<Unauthorized>() {
        return Failure::Site { status: 401 };
    }
    if error.is::<serde_json::Error>() {
        return Failure::Unreadable;
    }
    Failure::Offline { cause: Cause::Network }
}

/// The fetching thread, and what it is fetching or failed to fetch lately.
pub struct Fetcher {
    jobs: Sender<Job>,
    pending: HashMap<String, Option<Instant>>,
}

impl Fetcher {
    pub fn start(api: Api, inputs: Sender<Input>) -> Result<Self> {
        let (jobs, queue) = mpsc::channel::<Job>();
        thread::Builder::new().stack_size(12 * 1024).spawn(move || {
            for job in queue {
                let fetched = match job {
                    Job::Data { id, path } => {
                        let value = api.app_data(&path);
                        Fetched::Data { id, path, value }
                    }
                    Job::Image(request) => {
                        let bytes = api.app_image(&request.src);
                        Fetched::Image { request, bytes }
                    }
                    Job::Account { uid } => {
                        Fetched::Account(api.account(&AccountRequest { badge_uid: &uid }).map_err(|e| failure("account", &e)))
                    }
                    Job::CancelPurchase { uid, id } => Fetched::Cancelled(
                        api.cancel_purchase(&CancelPurchaseRequest { badge_uid: &uid, id: &id })
                            .map_err(|e| failure("cancel purchase", &e)),
                    ),
                };
                if inputs.send(Input::Fetched(fetched)).is_err() {
                    return;
                }
            }
        })?;
        Ok(Self { jobs, pending: HashMap::new() })
    }

    /// Asks for `job` unless it is on its way or failed less than `RETRY_AFTER` ago.
    pub fn request(&mut self, job: Job) {
        let Some(key) = job.key().map(str::to_owned) else {
            let _ = self.jobs.send(job);
            return;
        };
        if let Some(failed) = self.pending.get(&key) {
            if failed.is_none_or(|at| at.elapsed() < RETRY_AFTER) {
                return;
            }
        }
        if self.jobs.send(job).is_ok() {
            self.pending.insert(key, None);
        }
    }

    /// Notes a result in: done, or failed and held back for a while.
    pub fn arrived(&mut self, fetched: &Fetched) {
        let Some(key) = fetched.key().map(str::to_owned) else { return };
        if fetched.failed() {
            self.pending.insert(key, Some(Instant::now()));
        } else {
            self.pending.remove(&key);
        }
    }
}
