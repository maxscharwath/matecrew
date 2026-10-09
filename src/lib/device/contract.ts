/**
 * Wire format between the badge terminal and the site. The firmware mirrors
 * these shapes in `device/firmware`; change both together.
 *
 * The link endpoints follow RFC 8628 and keep its snake_case names. The others
 * use camelCase like the rest of the app.
 */
import { z } from "zod";

export const linkStartRequest = z.object({
  hardwareId: z.string().trim().min(1).max(64),
  firmwareVersion: z.string().trim().max(32).optional(),
});

export const linkStartResponse = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string(),
  expires_in: z.number().int(),
  interval: z.number().int(),
});

export const linkTokenRequest = z.object({
  device_code: z.string().min(1).max(128),
});

export const linkTokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  device_id: z.string(),
  device_name: z.string(),
  office_name: z.string(),
});

/** RFC 8628 §3.5 error codes, plus `invalid_grant` for an unknown device code. */
export const linkTokenError = z.object({
  error: z.enum([
    "authorization_pending",
    "slow_down",
    "access_denied",
    "expired_token",
    "invalid_grant",
  ]),
});

export const deviceKeyAction = z.enum(["TAKE", "RETURN"]);

export const deviceKey = z.object({
  action: deviceKeyAction,
  itemId: z.string().nullable(),
  label: z.string(),
});

export const deviceState = z.object({
  device: z.object({ id: z.string(), name: z.string() }),
  office: z.object({ name: z.string(), timezone: z.string(), locale: z.string() }),
  keys: z.object({ left: deviceKey, right: deviceKey }),
  items: z.array(z.object({ id: z.string(), name: z.string(), stock: z.number().int() })),
  /** Assigned badges only: an UID missing here is unknown to the terminal. */
  badges: z.array(z.object({ uid: z.string(), name: z.string() })),
  syncTimes: z.array(z.string()),
  serverTime: z.string(),
});

export const deviceTake = z.object({
  /** Id the terminal gives the take; resending it is harmless. */
  id: z.string().trim().min(1).max(64),
  badgeUid: z.string().trim().min(1).max(32),
  action: deviceKeyAction,
  itemId: z.string().nullable(),
  /** When the badge was read, ISO 8601. */
  at: z.iso.datetime(),
});

export const takesRequest = z.object({
  takes: z.array(deviceTake).max(200),
});

export const takesResponse = z.object({
  /** Every take id the server is done with; the terminal drops them from its queue. */
  done: z.array(z.string()),
  rejected: z.array(z.object({ id: z.string(), reason: z.string() })),
});

export const statusRequest = z.object({
  firmwareVersion: z.string().trim().max(32),
  batteryMv: z.number().int().min(0).max(5000).optional(),
  wifiRssi: z.number().int().min(-127).max(0).optional(),
  unknownBadges: z.array(z.string().trim().min(1).max(32)).max(50).default([]),
});

/**
 * What an admin does to the terminal from the site's console. Keys and badges
 * go through the same path as the real ones; a key or badge command older
 * than COMMAND_INPUT_TTL_SECONDS is dropped, not delivered late.
 */
export const deviceCommand = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("key"), side: z.enum(["left", "right"]) }),
  z.object({ id: z.string(), kind: z.literal("badge"), uid: z.string() }),
  z.object({ id: z.string(), kind: z.literal("sync") }),
  z.object({ id: z.string(), kind: z.literal("restart") }),
  /** Forget the Wi-Fi and start setup again; the token stays. */
  z.object({ id: z.string(), kind: z.literal("forgetWifi") }),
]);

/**
 * `GET /api/device/commands?wait=0..25`: held up to `wait` seconds until a
 * command arrives. Each command is delivered once.
 */
export const commandsResponse = z.object({
  commands: z.array(deviceCommand),
  /** Someone has the console open: worth staying awake and polling again. */
  live: z.boolean(),
});

export type LinkStartResponse =z.infer<typeof linkStartResponse>;
export type LinkTokenResponse = z.infer<typeof linkTokenResponse>;
export type LinkTokenError = z.infer<typeof linkTokenError>["error"];
export type DeviceState = z.infer<typeof deviceState>;
export type DeviceTake = z.infer<typeof deviceTake>;
export type TakesResponse = z.infer<typeof takesResponse>;
export type DeviceCommand = z.infer<typeof deviceCommand>;
export type CommandsResponse = z.infer<typeof commandsResponse>;
