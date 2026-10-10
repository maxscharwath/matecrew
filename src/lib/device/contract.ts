/**
 * Wire format between the badge terminal and the site. The firmware mirrors
 * these shapes in `device/core`; change both together.
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

/** What the screen writes above a key: left takes, right opens the badge holder's account. */
export const deviceKey = z.object({ label: z.string() });

/** The main screen's content. The server supplies it; the terminal's compiled screens own layout and pixels. */
export const deviceScreen = z.object({
  officeName: z.string(), time: z.string(),
  wifiBars: z.number().int().min(0).max(3).nullable(),
  batteryPercent: z.number().int().min(0).max(100).nullable(),
  batteryLowLabel: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      stock: z.number().int(),
      low: z.boolean(),
      /**
       * 96 x 96 as drawn, packed 1-bit, then its opacity plane (2 x 1152 bytes), base64:
       * ink black, opaque paper white, the rest transparent.
       */
      picture: z.string(),
    }),
  ),
  chart: z.object({ series: z.array(z.array(z.number().int())), max: z.number().int().positive(), days: z.number().int().positive() }).nullable(),
  preparation: z
    .object({
      title: z.string(),
      total: z.string(),
      items: z.array(
        z.object({ name: z.string(), count: z.number().int(), names: z.string(), picture: z.string() }),
      ),
      /** The session to serve; null for orders without one. */
      sessionId: z.string().nullable(),
      /** The right key on this screen: a runner's badge closes the session (`POST /api/device/serve`). */
      serveLabel: z.string(),
    })
    .nullable(),
  lowLabel: z.string(), moreLabel: z.string(), chartLabel: z.string(),
  leftLabel: z.string(), rightLabel: z.string(),
});
export type DeviceScreen = z.infer<typeof deviceScreen>;

/** `paper` is the native kit; `dark` is paper inverted; `flipper` and `macos` are the old 2× looks. */
export const deviceTheme = z.enum(["paper", "dark", "flipper", "macos"]);
export type DeviceTheme = z.infer<typeof deviceTheme>;

export const deviceState = z.object({
  device: z.object({ id: z.string(), name: z.string() }),
  office: z.object({ name: z.string(), timezone: z.string(), locale: z.string() }),
  keys: z.object({ left: deviceKey, right: deviceKey }),
  /** In the picker's order. `picture` as on the screen's items. */
  items: z.array(z.object({ id: z.string(), name: z.string(), stock: z.number().int(), picture: z.string() })),
  /**
   * Assigned badges only: an UID missing here is unknown to the terminal. What the holder drank
   * and bought stays on the site: "Mon compte" asks for it live (`POST /api/device/account`).
   */
  badges: z.array(z.object({ uid: z.string(), name: z.string() })),
  syncTimes: z.array(z.string()),
  serverTime: z.string(),
  screen: deviceScreen,
  /** Optional compiled DUI1 app; null uses the native matécrew screens. */
  appUrl: z.string().nullable(),
  theme: deviceTheme,
  /**
   * The newest firmware on the site; the terminal installs it when it is
   * newer than its own. `url` is a path on the site, fetched with the token.
   */
  firmware: z
    .object({ version: z.string(), url: z.string(), sha256: z.string(), size: z.number().int() })
    .nullable(),
});

export const deviceTake = z.object({
  /** Id the terminal gives the take; resending it is harmless. */
  id: z.string().trim().min(1).max(64),
  badgeUid: z.string().trim().min(1).max(32),
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

/** `POST /api/device/serve`: "Servi" on the preparation screen, then the runner's badge. */
export const serveRequest = z.object({
  /** The session the preparation screen showed; null for orders without one. */
  sessionId: z.string().nullable(),
  badgeUid: z.string().trim().min(1).max(32),
});

/** `POST /api/device/account`: the badge holder's account, "Mon compte" (the badge stays out of URLs). */
export const accountRequest = z.object({
  badgeUid: z.string().trim().min(1).max(32),
});

/** One of a person's purchases, newest first. */
export const purchase = z.object({
  id: z.string(),
  itemId: z.string(),
  item: z.string(),
  /** When, in the office's language and time zone ("Aujourd'hui · 14:05"). */
  when: z.string(),
  /** What it cost, formatted; null before a price is known. */
  price: z.string().nullable(),
});

/**
 * What the badge holder drank and bought, as the site counts it now, in the office's time zone and
 * language. A badge nobody holds in the device's office is a 404 `{ error: "unknown_badge" }`.
 */
export const deviceAccount = z.object({
  name: z.string(),
  /** Today, this week (from Monday) and this month. */
  today: z.number().int(),
  week: z.number().int(),
  month: z.number().int(),
  /** This month at the price the cans were bought, formatted: "CHF 12.40"; null when unknown. */
  cost: z.string().nullable(),
  /** The last 7 days, oldest first (`labels`): per day, a count per `products` entry. */
  days: z.array(z.array(z.number().int())),
  /** What `days` counts: the products drunk most, then "Autres" for the rest. */
  products: z.array(z.string()),
  /** Weekday of each `days` entry, in the office's language ("lun" … "dim"). */
  labels: z.array(z.string()),
  /** The latest purchases the site still counts (not cancelled), newest first. */
  purchases: z.array(purchase),
});

/** `POST /api/device/purchases/cancel`: the badge holder cancels one of their purchases. */
export const cancelPurchaseRequest = z.object({
  badgeUid: z.string().trim().min(1).max(32),
  id: z.string().min(1).max(64),
});
export const cancelPurchaseResponse = z.object({
  cancelled: z.boolean(),
  /** "already_cancelled" with `cancelled`; otherwise why not: "unknown_badge", "not_found", "not_yours". */
  reason: z.string().nullable(),
});

export const serveResponse = z.object({
  /** Orders marked served now; 0 when someone served them already. */
  served: z.number().int(),
  /** Why nothing was served: "unknown_badge" or "invalid_badge". */
  reason: z.string().nullable(),
});

export const statusRequest = z.object({
  firmwareVersion: z.string().trim().max(32),
  batteryMv: z.number().int().min(0).max(5000).optional(),
  wifiRssi: z.number().int().min(-127).max(0).optional(),
  unknownBadges: z.array(z.string().trim().min(1).max(32)).max(50),
});

/**
 * What an admin does to the terminal from the site's console. Keys and badges
 * go through the same path as the real ones; a key or badge command older
 * than COMMAND_INPUT_TTL_SECONDS is dropped, not delivered late.
 */
export const deviceCommand = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("key"), side: z.enum(["left", "right"]) }),
  /** Both keys together: the about page. */
  z.object({ id: z.string(), kind: z.literal("both") }),
  z.object({ id: z.string(), kind: z.literal("badge"), uid: z.string() }),
  z.object({ id: z.string(), kind: z.literal("sync"), app: z.enum(["mate", "showcase"]).optional() }),
  z.object({ id: z.string(), kind: z.literal("tap"), x: z.number().int().min(0).max(199), y: z.number().int().min(0).max(119) }),
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
export type ServeRequest = z.infer<typeof serveRequest>;
export type ServeResponse = z.infer<typeof serveResponse>;
export type Purchase = z.infer<typeof purchase>;
export type DeviceAccount = z.infer<typeof deviceAccount>;
export type CancelPurchaseResponse = z.infer<typeof cancelPurchaseResponse>;
export type DeviceCommand = z.infer<typeof deviceCommand>;
export type CommandsResponse = z.infer<typeof commandsResponse>;
