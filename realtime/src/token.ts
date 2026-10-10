/**
 * Short-lived tokens the site signs and the relay checks, so the relay never needs the
 * database: `base64url(claims).base64url(HMAC-SHA256(secret, base64url(claims)))`.
 *
 * Web Crypto only, so the same module runs in the Worker and in the site (Node 20+).
 */

/** Who opens a socket, or calls the relay. */
export type Role = "device" | "console" | "site";

export type Claims = {
  /** The terminal (`Device.id`). */
  sub: string;
  role: Role;
  /** Expiry, in seconds since 1970. */
  exp: number;
};

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unbase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** A token for `claims`, valid for `seconds` from `now` (seconds since 1970). */
export async function sign(
  secret: string,
  claims: Omit<Claims, "exp">,
  seconds: number,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify({ ...claims, exp: now + seconds })));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body)));
  return `${body}.${base64url(mac)}`;
}

/** The token's claims when its signature holds and it has not expired; null otherwise. */
export async function verify(
  secret: string,
  token: string,
  now = Math.floor(Date.now() / 1000),
): Promise<Claims | null> {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const signature = unbase64url(mac);
  if (!signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await key(secret), signature, encoder.encode(body));
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(unbase64url(body) ?? new Uint8Array())) as Partial<Claims>;
    const roles: Role[] = ["device", "console", "site"];
    if (
      typeof claims.sub !== "string" ||
      !roles.includes(claims.role as Role) ||
      typeof claims.exp !== "number" ||
      claims.exp <= now
    )
      return null;
    return { sub: claims.sub, role: claims.role as Role, exp: claims.exp };
  } catch {
    return null;
  }
}
