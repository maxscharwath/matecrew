import { prisma } from "@/lib/prisma";

/**
 * The MCP clients a given user has connected, and how to disconnect them.
 *
 * An `OauthApplication` row is the *client* (one row per registered Claude
 * installation) and is shared by everyone who connects through it, so it is
 * never what gets deleted here. The per-user link is the access token, so
 * revoking means dropping this user's tokens and consent for that client and
 * leaving the client registration alone.
 */

export interface McpConnection {
  clientId: string;
  clientName: string;
  connectedAt: Date;
  expiresAt: Date;
}

export async function listMcpConnections(
  userId: string,
): Promise<McpConnection[]> {
  // A refresh inserts a new token row rather than rotating one, so a client can
  // have many rows; the newest live one represents the connection.
  const tokens = await prisma.oauthAccessToken.findMany({
    where: { userId, refreshTokenExpiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      clientId: true,
      createdAt: true,
      refreshTokenExpiresAt: true,
      client: { select: { name: true } },
    },
  });

  const byClient = new Map<string, McpConnection>();
  for (const token of tokens) {
    if (byClient.has(token.clientId)) continue;
    byClient.set(token.clientId, {
      clientId: token.clientId,
      clientName: token.client.name,
      connectedAt: token.createdAt,
      expiresAt: token.refreshTokenExpiresAt,
    });
  }
  return [...byClient.values()];
}

/**
 * Cuts a client's access for one user. Returns false when the user had no
 * tokens for that client, so a stale button press reports honestly instead of
 * claiming to have revoked something.
 */
export async function revokeMcpConnection(
  userId: string,
  clientId: string,
): Promise<boolean> {
  const [tokens] = await prisma.$transaction([
    prisma.oauthAccessToken.deleteMany({ where: { userId, clientId } }),
    // Without this the next authorize would skip the consent screen.
    prisma.oauthConsent.deleteMany({ where: { userId, clientId } }),
  ]);
  return tokens.count > 0;
}
