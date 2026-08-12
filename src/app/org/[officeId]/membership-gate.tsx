import { getOptionalMembership, getUserMemberships } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { OfficeCookie } from "@/components/office-cookie";
import { LocaleSync } from "@/components/locale-sync";
import { JoinRequestScreen } from "@/components/join-request-screen";
import { SidebarShell } from "@/components/sidebar-shell";
import { countUnread } from "@/lib/whats-new/read-state";
import { redirect } from "next/navigation";

interface Props {
  readonly children: React.ReactNode;
  readonly officeId: string;
}

export async function MembershipGate({ children, officeId }: Props) {
  const { session, membership } = await getOptionalMembership(officeId);

  if (!membership) {
    const [office, existingRequest] = await Promise.all([
      prisma.office.findUnique({
        where: { id: officeId },
        select: { id: true, name: true },
      }),
      prisma.joinRequest.findUnique({
        where: {
          userId_officeId: { userId: session.user.id, officeId },
        },
      }),
    ]);

    if (!office) {
      redirect("/");
    }

    return (
      <JoinRequestScreen
        officeId={office.id}
        officeName={office.name}
        existingRequest={
          existingRequest
            ? { id: existingRequest.id, status: existingRequest.status }
            : null
        }
      />
    );
  }

  const [memberships, avatarUrl, unreadWhatsNew] = await Promise.all([
    getUserMemberships(session.user.id),
    resolveAvatarUrl(membership.user.image),
    // This gate builds the shell itself rather than going through
    // getSidebarData(), so the unread count has to be fetched here too or the
    // badge would silently read zero on every office page.
    countUnread(session.user.id),
  ]);
  const isAdmin = membership.roles.includes("ADMIN");

  return (
    <SidebarShell
      officeId={officeId}
      isAdmin={isAdmin}
      memberships={memberships.map((m) => ({
        officeId: m.office.id,
        officeName: m.office.name,
      }))}
      avatarUrl={avatarUrl}
      emailVerified={session.user.emailVerified}
      userEmail={session.user.email}
      unreadWhatsNew={unreadWhatsNew}
    >
      <OfficeCookie officeId={officeId} />
      <LocaleSync userLocale={membership.user.locale ?? "fr"} />
      {children}
    </SidebarShell>
  );
}
