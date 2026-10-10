/**
 * Configuration and secrets, by name.
 *
 * Every variable the app reads at runtime is listed in `EnvName`, so a typo is
 * a type error and `.dev.vars.example` can be checked against one list.
 * Where the values come from is the adapter's business: Worker vars and
 * secrets on Cloudflare, App Settings or Key Vault references on Azure,
 * `.env.local` on Node. Bindings (database, bucket, queue) are not variables
 * and never appear here.
 */
export type EnvName =
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "NEXT_PUBLIC_APP_URL"
  | "ALLOWED_EMAIL_DOMAINS"
  | "DISABLE_PASSWORD_AUTH"
  | "EMAIL_DOMAIN_ALIASES"
  | "MICROSOFT_CLIENT_ID"
  | "MICROSOFT_CLIENT_SECRET"
  | "MICROSOFT_TENANT_ID"
  | "SLACK_BOT_TOKEN"
  | "SLACK_SIGNING_SECRET"
  | "SLACK_BOT_USERNAME"
  | "SLACK_BOT_ICON_URL"
  | "RESEND_API_KEY"
  | "EMAIL_FROM"
  | "DEVICE_UI_APP"
  | "DEVICE_UI_THEME"
  // The Cloudflare Worker's platform bridge (src/platform/cloudflare/bridge):
  // its origin, for a deployment that shares that Worker's data (Vercel), and
  // the secret both sides sign with, a database credential.
  | "PLATFORM_BRIDGE_URL"
  | "PLATFORM_BRIDGE_SECRET";

export interface AppEnv {
  /** The value, or undefined when the variable is unset or empty. */
  get(name: EnvName): string | undefined;
  /** The value; throws an error naming the variable when it is unset or empty. */
  require(name: EnvName): string;
  /**
   * The app's public origin, without a trailing slash. It is also the OAuth
   * issuer advertised to MCP clients, so it must be the same on every call.
   */
  baseUrl(): string;
}
