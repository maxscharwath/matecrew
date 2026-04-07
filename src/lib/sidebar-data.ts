import "server-only";

import { cookies } from "next/headers";
import { requireSession, getUserMemberships } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";

export async function getSidebarData() {
  const session = await requireSession();
  const memberships = await getUserMemberships(session.user.id);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { locale: true, image: true },
  });

  const avatarUrl = resolveAvatarUrl(user?.image);
  const store = await cookies();
  const lastOfficeId =
    store.get("officeId")?.value ?? memberships[0]?.office.id;

  const activeMembership = memberships.find(
    (m) => m.office.id === lastOfficeId,
  );
  const isAdmin = activeMembership
    ? (activeMembership as { roles: string[] }).roles.includes("ADMIN")
    : false;

  return {
    officeId: lastOfficeId ?? "",
    isAdmin,
    memberships: memberships.map((m) => ({
      officeId: m.office.id,
      officeName: m.office.name,
    })),
    avatarUrl,
    userLocale: user?.locale ?? "fr",
    emailVerified: session.user.emailVerified,
    userEmail: session.user.email,
  };
}
