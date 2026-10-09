import { createHash, randomBytes, randomInt } from "node:crypto";

/** No 0/O or 1/I: the code is read off an e-ink screen and typed on a phone. */
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_LENGTH = 8;

/** How long a terminal's link request stays valid. */
export const LINK_TTL_SECONDS = 10 * 60;
/** Minimum seconds between two token polls (RFC 8628 `interval`). */
export const LINK_POLL_INTERVAL_SECONDS = 5;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Secret the terminal keeps for the whole link: 256 random bits. */
export function newDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

/** Bearer token a linked terminal sends on every call. Prefixed so a leaked one is recognisable. */
export function newDeviceToken(): string {
  return `mcd_${randomBytes(32).toString("base64url")}`;
}

export function newUserCode(): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

/** "ABCD2345" → "ABCD-2345", the way the terminal shows it. */
export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Accepts what a person types: any case, with or without the dash or spaces. */
export function normalizeUserCode(input: string): string | null {
  const code = input.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  if (code.length !== USER_CODE_LENGTH) return null;
  return [...code].every((c) => USER_CODE_ALPHABET.includes(c)) ? code : null;
}

/** Uppercase hex without separators, whatever the terminal or a person sent. */
export function normalizeBadgeUid(input: string): string | null {
  const uid = input.toUpperCase().replaceAll(/[^0-9A-F]/g, "");
  return uid.length >= 8 && uid.length <= 20 && uid.length % 2 === 0 ? uid : null;
}
