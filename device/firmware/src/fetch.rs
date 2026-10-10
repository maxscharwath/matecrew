//! What an app fetches while someone uses the terminal, its data and its images, on a thread of
//! its own: a site that does not answer never holds the keys. Each result comes back to the main
//! loop as an input, and the screen shows it then.

use anyhow::Result;
use matecrew_ui::engine::image::ImageRequest;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::mpsc::{self, Sender},
    thread,
    time::{Duration, Instant},
};

use crate::{api::Api, Input};

/// A request that failed is not sent again before this: the site is likely down.
const RETRY_AFTER: Duration = Duration::from_secs(30);

pub enum Job {
    Data { id: String, path: String },
    Image(ImageRequest),
}

impl Job {
    fn key(&self) -> &str {
        match self {
            Job::Data { path, .. } => path,
            Job::Image(request) => &request.src,
        }
    }
}

pub enum Fetched {
    Data { id: String, path: String, value: Result<Value> },
    Image { request: ImageRequest, bytes: Result<Vec<u8>> },
}

impl Fetched {
    fn key(&self) -> &str {
        match self {
            Fetched::Data { path, .. } => path,
            Fetched::Image { request, .. } => &request.src,
        }
    }
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
        let key = job.key().to_owned();
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
        let failed = match fetched {
            Fetched::Data { value, .. } => value.is_err(),
            Fetched::Image { bytes, .. } => bytes.is_err(),
        };
        if failed {
            self.pending.insert(fetched.key().to_owned(), Some(Instant::now()));
        } else {
            self.pending.remove(fetched.key());
        }
    }
}
