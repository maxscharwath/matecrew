//! DUI1 limits, mirrored by authoring/limits.ts and enforced before execution.
pub const MAX_BYTES: usize = 64 * 1024;
pub const MAX_VIEWPORT: u32 = 4096;
pub const MAX_DEPTH: usize = 16;
pub const MAX_NODES: usize = 256;
pub const MAX_ACTIONS: usize = 256;
pub const MAX_RESOURCES: usize = 16;
pub const MAX_STRINGS: usize = 4096;
pub const MAX_VALUES: usize = 4096;
pub const MAX_LOCAL_STATE: usize = 8 * 1024;

pub fn valid_identifier(id: &str) -> bool {
    let mut bytes = id.bytes();
    matches!(bytes.next(), Some(b) if b.is_ascii_alphabetic() || b == b'_')
        && id.len() <= 64
        && id != "__proto__"
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub fn valid_api_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && path.len() <= 256
        && !path.bytes().any(|b| b <= b' ' || b == 127 || b == b'\\')
}
