use super::*;
use serde::{Deserialize, Serialize};
use std::{
    cell::{Cell, RefCell},
    time::Duration,
};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct State {
    office: String,
    stock: Vec<u32>,
}

const STATE: Key<State> = Key::new("state").keep(Keep::Forever).max_bytes(1024);
const APP: Key<Vec<u8>, Raw> = Key::new("app").keep(Keep::For(DAY)).max_bytes(64);
const NOTE: Key<String> = Key::new("note").keep(Keep::For(HOUR));

const OCT_10: u64 = 1_791_590_400; // 2026-10-10, Unix seconds

thread_local! {
    // Each test runs on its own thread: a clock and a report log per test.
    static NOW: Cell<Option<u64>> = const { Cell::new(Some(OCT_10)) };
    static REPORTS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn clock() -> Option<u64> {
    NOW.with(Cell::get)
}

fn set_clock(now: Option<u64>) {
    NOW.with(|cell| cell.set(now));
}

fn report(error: &Error) {
    REPORTS.with(|reports| reports.borrow_mut().push(error.to_string()));
}

fn reports() -> Vec<String> {
    REPORTS.with(|reports| reports.borrow_mut().drain(..).collect())
}

fn cache() -> Cache<MemoryBackend> {
    Cache::open(MemoryBackend::new()).clock(clock).on_error(report)
}

fn state() -> State {
    State { office: "Lausanne".into(), stock: vec![36, 12] }
}

#[test]
fn a_value_reads_back_as_it_was_put() {
    let cache = cache();
    assert_eq!(cache.get(&STATE).unwrap(), None);
    cache.put(&STATE, &state()).unwrap();
    assert_eq!(cache.get(&STATE).unwrap(), Some(state()));
    cache.put(&APP, &b"DUI1\x00\x01".to_vec()).unwrap();
    assert_eq!(cache.get(&APP).unwrap(), Some(b"DUI1\x00\x01".to_vec()));
    // Raw bytes are kept as they are, after the header.
    assert_eq!(&cache.backend().raw("app").unwrap()[entry::HEADER..], b"DUI1\x00\x01");
    cache.forget(&STATE).unwrap();
    assert_eq!(cache.get(&STATE).unwrap(), None);
    assert!(reports().is_empty());
}

#[test]
fn an_entry_expires_after_its_keep_and_is_removed() {
    let cache = cache();
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    set_clock(Some(OCT_10 + 3_599));
    assert_eq!(cache.get(&NOTE).unwrap().as_deref(), Some("hello"));
    set_clock(Some(OCT_10 + 3_600));
    assert_eq!(cache.get(&NOTE).unwrap(), None);
    assert_eq!(cache.backend().raw("note"), None);
    // Expiring is not an error.
    assert!(reports().is_empty());
}

#[test]
fn nothing_expires_while_the_clock_is_not_set() {
    let cache = cache();
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    // A restart without NTP: the clock counts from 1970 again.
    set_clock(Some(40));
    assert_eq!(cache.get(&NOTE).unwrap().as_deref(), Some("hello"));
    set_clock(None);
    assert_eq!(cache.get(&NOTE).unwrap().as_deref(), Some("hello"));
}

#[test]
fn an_entry_written_before_the_clock_was_set_keeps_from_the_first_read_with_one() {
    let cache = cache();
    set_clock(Some(12));
    cache.put(&NOTE, &"early".to_owned()).unwrap();
    assert_eq!(cache.usage().entries[0].expires, Expires::Pending(HOUR));
    // The clock is set much later: the hour starts at this read, which dates the entry.
    set_clock(Some(OCT_10 + 5 * 86_400));
    assert_eq!(cache.get(&NOTE).unwrap().as_deref(), Some("early"));
    assert_eq!(cache.usage().entries[0].written, Some(OCT_10 + 5 * 86_400));
    set_clock(Some(OCT_10 + 5 * 86_400 + 3_599));
    assert_eq!(cache.get(&NOTE).unwrap().as_deref(), Some("early"));
    set_clock(Some(OCT_10 + 5 * 86_400 + 3_600));
    assert_eq!(cache.get(&NOTE).unwrap(), None);
}

#[test]
fn a_clock_that_went_back_keeps_the_entry() {
    let cache = cache();
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    set_clock(Some(OCT_10 - 86_400));
    assert_eq!(cache.get(&NOTE).unwrap().as_deref(), Some("hello"));
}

#[test]
fn forever_means_until_replaced() {
    let cache = cache();
    cache.put(&STATE, &state()).unwrap();
    set_clock(Some(OCT_10 + 10 * 365 * 86_400));
    assert_eq!(cache.get(&STATE).unwrap(), Some(state()));
}

#[test]
fn a_shorter_keep_in_a_newer_key_applies_to_older_entries() {
    let cache = cache();
    const LONG: Key<String> = Key::new("note").keep(Keep::For(WEEK));
    cache.put(&LONG, &"hello".to_owned()).unwrap();
    set_clock(Some(OCT_10 + 2 * 3_600));
    assert_eq!(cache.get(&NOTE).unwrap(), None);
}

#[test]
fn a_damaged_entry_reads_as_missing_is_removed_and_reported() {
    let cache = cache();
    cache.put(&STATE, &state()).unwrap();
    let mut bytes = cache.backend().raw("state").unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    cache.backend().write("state", &bytes).unwrap();
    assert_eq!(cache.get(&STATE).unwrap(), None);
    assert_eq!(cache.backend().raw("state"), None);
    assert_eq!(reports(), ["state: dropped, bad checksum"]);
    // Cut short, as a write a power cut interrupted on a backend without atomic writes.
    cache.put(&STATE, &state()).unwrap();
    let bytes = cache.backend().raw("state").unwrap();
    cache.backend().write("state", &bytes[..bytes.len() - 4]).unwrap();
    assert_eq!(cache.get(&STATE).unwrap(), None);
    assert_eq!(reports(), ["state: dropped, truncated"]);
}

#[test]
fn an_entry_in_another_format_reads_as_missing() {
    let cache = cache();
    // Bare JSON, without the header.
    cache.backend().write("state", br#"{"office":"Lausanne","stock":[36]}"#).unwrap();
    assert_eq!(cache.get(&STATE).unwrap(), None);
    assert_eq!(reports(), ["state: dropped, not a cache entry"]);
    // Another value version.
    cache.put(&STATE, &state()).unwrap();
    assert_eq!(cache.get(&STATE.version(2)).unwrap(), None);
    assert_eq!(reports(), ["state: dropped, another version"]);
    // The same version with a type that changed under it.
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    const NOTE_AS_NUMBER: Key<u32> = Key::new("note");
    assert_eq!(cache.get(&NOTE_AS_NUMBER).unwrap(), None);
    assert_eq!(reports(), ["note: dropped, value does not decode"]);
}

#[test]
fn a_value_over_its_limit_is_refused_and_the_old_one_stays() {
    let cache = cache();
    cache.put(&APP, &vec![1; 64]).unwrap();
    let error = cache.put(&APP, &vec![2; 65]).unwrap_err();
    assert!(matches!(error, Error::TooLarge { key: "app", bytes: 65, max: 64 }), "{error}");
    assert_eq!(cache.get(&APP).unwrap(), Some(vec![1; 64]));
}

#[test]
fn keys_keep_a_small_default() {
    const SMALL: Key<String> = Key::new("small");
    assert_eq!(SMALL.limit(), DEFAULT_MAX_BYTES);
    assert_eq!(SMALL.kept(), Keep::For(DAY));
    let cache = cache();
    let big = "x".repeat(DEFAULT_MAX_BYTES);
    assert!(matches!(cache.put(&SMALL, &big), Err(Error::TooLarge { .. })));
}

#[test]
#[should_panic(expected = "1 to 15 bytes")]
fn a_name_longer_than_nvs_allows_is_refused() {
    let _ = Key::<u8>::new("a_much_too_long_name");
}

#[test]
fn remember_computes_once() {
    let cache = cache();
    let calls = Cell::new(0);
    let compute = || {
        calls.set(calls.get() + 1);
        Ok::<_, String>("computed".to_owned())
    };
    assert_eq!(cache.remember(&NOTE, compute).unwrap(), "computed");
    assert_eq!(cache.remember(&NOTE, compute).unwrap(), "computed");
    assert_eq!(calls.get(), 1);
    // Its own error comes back, and nothing is kept.
    cache.forget(&NOTE).unwrap();
    assert_eq!(cache.remember(&NOTE, || Err::<String, _>("offline")), Err("offline"));
    assert_eq!(cache.get(&NOTE).unwrap(), None);
}

#[test]
fn remember_returns_a_value_it_cannot_keep() {
    let cache = cache();
    assert_eq!(cache.remember(&APP, || Ok::<_, ()>(vec![7; 100])), Ok(vec![7; 100]));
    assert_eq!(cache.get(&APP).unwrap(), None);
    assert_eq!(reports(), ["app: 100 bytes, over its 64"]);
}

#[test]
fn usage_says_what_is_cached_for_how_long_and_how_big() {
    let cache = cache();
    cache.put(&STATE, &state()).unwrap();
    cache.put(&APP, &vec![0; 64]).unwrap();
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    set_clock(Some(OCT_10 + 1_800));
    let usage = cache.usage();
    assert_eq!(usage.used, (20 + 37) + (20 + 64) + (20 + 7));
    assert_eq!(usage.total, None);
    let keys: Vec<_> = usage.entries.iter().map(|e| (e.key.as_str(), e.bytes, e.expires)).collect();
    assert_eq!(
        keys,
        [
            ("app", 84, Expires::At(OCT_10 + 86_400)),
            ("state", 57, Expires::Never),
            ("note", 27, Expires::At(OCT_10 + 3_600)),
        ]
    );
    assert_eq!(
        usage.to_string(),
        "168 B in 3 entries\n  app                  84 B  23 h 30 min left\n  state                57 B  kept for ever\n  note                 27 B  30 min left"
    );
}

#[test]
fn usage_reads_entries_an_earlier_run_left_once() {
    let backend = MemoryBackend::new();
    let earlier = Cache::open(&backend).clock(clock);
    earlier.put(&STATE, &state()).unwrap();
    earlier.put(&NOTE, &"hello".to_owned()).unwrap();
    backend.write("junk", b"not an entry").unwrap();
    let cache = Cache::open(&backend).clock(clock).on_error(report);
    set_clock(Some(OCT_10 + 3_600));
    let usage = cache.usage();
    // The expired note and the junk are gone, the state stays.
    assert_eq!(usage.entries.len(), 1);
    assert_eq!(usage.entries[0].key, "state");
    assert_eq!(backend.names().unwrap(), ["state"]);
    assert_eq!(reports(), ["junk: dropped, not a cache entry"]);
}

#[test]
fn clear_removes_every_entry() {
    let cache = cache();
    cache.put(&STATE, &state()).unwrap();
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    cache.backend().write("stray", b"{}").unwrap();
    cache.clear().unwrap();
    assert!(cache.backend().names().unwrap().is_empty());
    assert_eq!(cache.usage().used, 0);
}

/// Counts writes, to see the flash spared.
#[derive(Default)]
struct Counting {
    inner: MemoryBackend,
    writes: Cell<usize>,
}

impl Backend for Counting {
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, Error> {
        self.inner.read(name)
    }
    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), Error> {
        self.writes.set(self.writes.get() + 1);
        self.inner.write(name, bytes)
    }
    fn remove(&self, name: &str) -> Result<(), Error> {
        self.inner.remove(name)
    }
    fn names(&self) -> Result<Vec<String>, Error> {
        self.inner.names()
    }
}

#[test]
fn the_same_value_again_is_not_written() {
    let cache = Cache::open(Counting::default()).clock(clock);
    cache.put(&STATE, &state()).unwrap();
    cache.put(&STATE, &state()).unwrap();
    assert_eq!(cache.backend().writes.get(), 1);
    cache.put(&STATE, &State { office: "Genève".into(), ..state() }).unwrap();
    assert_eq!(cache.backend().writes.get(), 2);
    // Read back after a restart, it is still known.
    let restarted = Cache::open(Counting { inner: MemoryBackend::new(), writes: Cell::new(0) }).clock(clock);
    restarted.backend().inner.write("state", &cache.backend().inner.raw("state").unwrap()).unwrap();
    let current = restarted.get(&STATE).unwrap().unwrap();
    restarted.put(&STATE, &current).unwrap();
    assert_eq!(restarted.backend().writes.get(), 0);
}

#[test]
fn the_same_value_is_dated_again_past_half_its_keep() {
    let cache = Cache::open(Counting::default()).clock(clock);
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    set_clock(Some(OCT_10 + 1_799));
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    assert_eq!(cache.backend().writes.get(), 1);
    set_clock(Some(OCT_10 + 1_800));
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    assert_eq!(cache.backend().writes.get(), 2);
    // Kept an hour from then, not from the first write.
    set_clock(Some(OCT_10 + 5_000));
    assert_eq!(cache.get(&NOTE).unwrap().as_deref(), Some("hello"));
}

#[test]
fn the_same_value_written_without_a_clock_is_dated_once_there_is_one() {
    let cache = Cache::open(Counting::default()).clock(clock);
    set_clock(None);
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    assert_eq!(cache.backend().writes.get(), 1);
    set_clock(Some(OCT_10));
    cache.put(&NOTE, &"hello".to_owned()).unwrap();
    assert_eq!(cache.backend().writes.get(), 2);
    assert_eq!(cache.usage().entries[0].written, Some(OCT_10));
}

#[test]
fn keep_durations_fit_the_header() {
    assert_eq!(Keep::Forever.secs(), u32::MAX);
    assert_eq!(Keep::For(DAY).secs(), 86_400);
    assert_eq!(Keep::For(Duration::from_secs(u64::MAX)).secs(), u32::MAX - 1);
}
