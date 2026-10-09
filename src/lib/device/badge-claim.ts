import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeBadgeUid } from "@/lib/device/codes";

/** How long the QR of an unknown badge stays good after the terminal read it. */
export const CLAIM_TTL_SECONDS = 10 * 60;

export type ClaimParams = { d?: string; u?: string; t?: string; s?: string };

/**
 * The signature the terminal puts in its claim link (device/core/src/claim.rs):
 * the first 16 bytes of an HMAC-SHA256 of `device|uid|unix`, keyed with the
 * SHA-256 of its token, which the site stores as `tokenHash`.
 */
export function claimSignature(tokenHash: string, deviceId: string, uid: string, unix: number): string {
  return createHmac("sha256", Buffer.from(tokenHash, "hex"))
    .update(`${deviceId}|${uid}|${unix}`)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

export type VerifiedClaim =
  | { ok: true; uid: string; device: { id: string; name: string; office: { id: string; name: string } } }
  | { ok: false; reason: "invalid" | "expired" };

/** Checks that a terminal read this badge less than CLAIM_TTL_SECONDS ago and signed the link. */
export async function verifyClaim(params: ClaimParams, now = Date.now()): Promise<VerifiedClaim> {
  const uid = params.u ? normalizeBadgeUid(params.u) : null;
  const unix = Number(params.t);
  if (!params.d || !uid || !params.s || !Number.isInteger(unix)) return { ok: false, reason: "invalid" };

  const device = await prisma.device.findUnique({
    where: { id: params.d },
    select: { id: true, name: true, tokenHash: true, office: { select: { id: true, name: true } } },
  });
  if (!device) return { ok: false, reason: "invalid" };

  const expected = Buffer.from(claimSignature(device.tokenHash, device.id, uid, unix));
  const given = Buffer.from(params.s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };

  const age = now / 1000 - unix;
  // A minute of slack for a terminal clock slightly ahead.
  if (age > CLAIM_TTL_SECONDS || age < -60) return { ok: false, reason: "expired" };
  return { ok: true, uid, device: { id: device.id, name: device.name, office: device.office } };
}
