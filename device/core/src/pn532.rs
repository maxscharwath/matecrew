//! Frames of the NXP PN532 NFC controller (user manual UM0701-02, §6.2). The
//! firmware moves the bytes over I2C; building and checking them happens here.

/// 7-bit I2C address.
pub const ADDRESS: u8 = 0x24;
/// First byte of every I2C read: the PN532 has something to say.
pub const READY: u8 = 0x01;
pub const ACK: [u8; 6] = [0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00];

pub const GET_FIRMWARE_VERSION: u8 = 0x02;
pub const SAM_CONFIGURATION: u8 = 0x14;
pub const RF_CONFIGURATION: u8 = 0x32;
pub const IN_LIST_PASSIVE_TARGET: u8 = 0x4A;

const HOST_TO_PN532: u8 = 0xD4;
const PN532_TO_HOST: u8 = 0xD5;
const ERROR_FRAME: u8 = 0x7F;

/// SAM in normal mode, no IRQ (it is not wired).
pub const SAM_NORMAL: [u8; 3] = [0x01, 0x14, 0x00];
/// MaxRetries: give up a passive activation after two tries, so asking for a
/// badge returns at once when there is none instead of waiting forever.
pub const FEW_RETRIES: [u8; 4] = [0x05, 0xFF, 0x01, 0x02];
/// One target at 106 kbit/s, ISO 14443 type A: MIFARE, DESFire.
pub const ONE_TYPE_A_TARGET: [u8; 2] = [0x01, 0x00];

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    /// No start code, or the frame stops early.
    Truncated,
    Checksum,
    /// The PN532 sent its error frame: it could not read the command.
    Refused,
    /// A frame, but not the answer to this command.
    Unexpected,
}

/// Information frame carrying `command` and its parameters.
pub fn command(command: u8, params: &[u8]) -> Vec<u8> {
    let len = (params.len() + 2) as u8;
    let sum = params.iter().fold(HOST_TO_PN532.wrapping_add(command), |sum, b| sum.wrapping_add(*b));
    let mut frame = vec![0x00, 0x00, 0xFF, len, len.wrapping_neg(), HOST_TO_PN532, command];
    frame.extend_from_slice(params);
    frame.extend_from_slice(&[sum.wrapping_neg(), 0x00]);
    frame
}

pub fn is_ack(bytes: &[u8]) -> bool {
    bytes.starts_with(&ACK)
}

/// Data of the answer to `command`, from the bytes read after the status byte.
pub fn response(bytes: &[u8], command: u8) -> Result<&[u8], FrameError> {
    let start = bytes
        .windows(2)
        .position(|w| w == [0x00, 0xFF])
        .ok_or(FrameError::Truncated)?
        + 2;
    let (&len, &lcs) = (bytes.get(start).ok_or(FrameError::Truncated)?, bytes.get(start + 1).ok_or(FrameError::Truncated)?);
    if len.wrapping_add(lcs) != 0 {
        return Err(FrameError::Checksum);
    }
    let body = bytes.get(start + 2..start + 2 + len as usize).ok_or(FrameError::Truncated)?;
    let dcs = *bytes.get(start + 2 + len as usize).ok_or(FrameError::Truncated)?;
    if body.iter().fold(dcs, |sum, b| sum.wrapping_add(*b)) != 0 {
        return Err(FrameError::Checksum);
    }
    match body {
        [ERROR_FRAME] => Err(FrameError::Refused),
        [PN532_TO_HOST, code, data @ ..] if *code == command.wrapping_add(1) => Ok(data),
        _ => Err(FrameError::Unexpected),
    }
}

/// UID of the first card in an InListPassiveTarget answer, if there is one.
pub fn target_uid(data: &[u8]) -> Option<&[u8]> {
    // NbTg, Tg, SENS_RES (2), SEL_RES, NFCIDLength, NFCID1...
    if data.first().copied().unwrap_or(0) == 0 {
        return None;
    }
    let len = *data.get(5)? as usize;
    data.get(6..6 + len).filter(|uid| !uid.is_empty())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_frames_from_the_manual() {
        // GetFirmwareVersion, UM0701-02 §7.2.2.
        assert_eq!(command(GET_FIRMWARE_VERSION, &[]), [0x00, 0x00, 0xFF, 0x02, 0xFE, 0xD4, 0x02, 0x2A, 0x00]);
        assert_eq!(
            command(SAM_CONFIGURATION, &SAM_NORMAL),
            [0x00, 0x00, 0xFF, 0x05, 0xFB, 0xD4, 0x14, 0x01, 0x14, 0x00, 0x03, 0x00]
        );
    }

    #[test]
    fn reads_the_firmware_version() {
        let bytes = [0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5, 0x03, 0x32, 0x01, 0x06, 0x07, 0xE8, 0x00, 0x00, 0x00];
        assert_eq!(response(&bytes, GET_FIRMWARE_VERSION), Ok(&[0x32, 0x01, 0x06, 0x07][..]));
    }

    #[test]
    fn rejects_damaged_or_foreign_frames() {
        let good = [0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5, 0x03, 0x32, 0x01, 0x06, 0x07, 0xE8, 0x00];
        let mut bad_sum = good;
        bad_sum[8] ^= 1;
        assert_eq!(response(&bad_sum, GET_FIRMWARE_VERSION), Err(FrameError::Checksum));
        assert_eq!(response(&good[..9], GET_FIRMWARE_VERSION), Err(FrameError::Truncated));
        assert_eq!(response(&good, SAM_CONFIGURATION), Err(FrameError::Unexpected));
        assert_eq!(response(&[0x00, 0x00, 0xFF, 0x01, 0xFF, 0x7F, 0x81, 0x00], 0x02), Err(FrameError::Refused));
        assert_eq!(response(&[0x00; 8], 0x02), Err(FrameError::Truncated));
    }

    #[test]
    fn finds_the_uid_of_a_desfire_card() {
        // One target, SENS_RES 0x0344, SEL_RES 0x20 (DESFire), 7-byte UID, then its ATS.
        let data = [0x01, 0x01, 0x03, 0x44, 0x20, 0x07, 0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x06, 0x75];
        assert_eq!(target_uid(&data).map(hex).as_deref(), Some("04112233445566"));
        assert_eq!(target_uid(&[0x00]), None);
        assert_eq!(target_uid(&[0x01, 0x01, 0x03]), None);
    }
}
