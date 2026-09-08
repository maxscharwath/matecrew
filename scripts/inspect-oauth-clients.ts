/**
 * Lists the OAuth clients MCP clients have registered against MateCrew.
 *
 * Usage:  bun scripts/inspect-oauth-clients.ts [clientId]
 *
 * `authorize` matches `redirect_uri` byte-for-byte against the stored list, so
 * when a client fails with "Invalid redirect URI" this is the ground truth:
 * whatever it registered is not what it is now sending.
 *
 * Against production:
 *   vercel env pull prod.env --environment=production
 *   set -a && source prod.env && set +a && bun scripts/inspect-oauth-clients.ts
 * (`bun --env-file` does not beat .env.local — real env vars do.)
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const only = process.argv[2];

  const clients = await prisma.oauthApplication.findMany({
    where: only ? { clientId: only } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { accessTokens: true } } },
  });

  console.log(`${clients.length} registered client(s)\n`);

  for (const client of clients) {
    console.log(`${client.name || "(unnamed)"}`);
    console.log(`  clientId     ${client.clientId}`);
    console.log(`  type         ${client.type}${client.disabled ? " (DISABLED)" : ""}`);
    console.log(`  registered   ${client.createdAt.toISOString()}`);
    console.log(`  tokens       ${client._count.accessTokens}`);
    console.log(`  redirectUrls (${client.redirectUrls.split(",").length}, as stored, one per line)`);
    for (const url of client.redirectUrls.split(",")) {
      console.log(`    ${JSON.stringify(url)}`);
    }
    if (client.metadata) console.log(`  metadata     ${client.metadata}`);
    console.log();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
