import { prisma } from "@/lib/prisma";

/**
 * Deletes OAuth access tokens whose refresh token has also expired.
 *
 * The refresh grant inserts a new `OauthAccessToken` row rather than rotating
 * one in place, so the table grows with every MCP client refresh (hourly, per
 * connected client). Once the refresh token is past its expiry the row can
 * never authenticate anything again, so it is safe to drop.
 *
 * Keyed on `refreshTokenExpiresAt` — the later of the two expiries — so a row
 * whose access token has expired but whose refresh token is still usable stays.
 */
export async function pruneExpiredOauthTokens(): Promise<{ deleted: number }> {
  const { count } = await prisma.oauthAccessToken.deleteMany({
    where: { refreshTokenExpiresAt: { lt: new Date() } },
  });
  return { deleted: count };
}
