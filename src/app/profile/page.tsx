import { getFormatter, getTranslations } from "next-intl/server";
import { requireSession, getUserMemberships } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { getConnectLinks } from "@/lib/mcp/connect-links";
import { listMcpConnections } from "@/lib/mcp/connections";
import { ProfileForm } from "@/components/profile-form";
import { ConnectClaudeCard } from "@/components/connect-claude-card";

export default async function ProfilePage() {
  const session = await requireSession();
  const t = await getTranslations();
  const format = await getFormatter();

  const [user, memberships, connections] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true, locale: true, defaultOfficeId: true },
    }),
    getUserMemberships(session.user.id),
    listMcpConnections(session.user.id),
  ]);

  const avatarUrl = resolveAvatarUrl(user.image);

  const offices = memberships.map((m) => ({
    id: m.office.id,
    name: m.office.name,
  }));

  const connectLinks = getConnectLinks();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("profile.subtitle")}</p>
      </div>
      <ProfileForm user={user} avatarUrl={avatarUrl} offices={offices} />
      <ConnectClaudeCard
        {...connectLinks}
        // Claude Code is the primary route: adding a custom connector on
        // claude.ai/Desktop depends on Claude org policy, which may forbid it.
        // Dates are formatted server-side so the markup matches on hydration
        // regardless of the visitor's own locale settings.
        connections={connections.map((c) => ({
          clientId: c.clientId,
          clientName: c.clientName,
          connectedAt: format.dateTime(c.connectedAt, {
            dateStyle: "medium",
          }),
        }))}
        adminOffices={memberships
          .filter((m) => (m as { roles: string[] }).roles.includes("ADMIN"))
          .map((m) => m.office.name)}
      />
    </div>
  );
}
