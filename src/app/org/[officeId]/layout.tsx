import { requireMembership, getUserMemberships } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { LocaleSync } from "@/components/locale-sync";

interface Props {
  readonly children: React.ReactNode;
  readonly params: Promise<{ officeId: string }>;
}

export default async function OrgLayout({ children, params }: Props) {
  const { officeId } = await params;
  const { session, membership } = await requireMembership(officeId);
  const memberships = await getUserMemberships(session.user.id);
  const isAdmin = membership.roles.includes("ADMIN");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { locale: true },
  });

  return (
    <div className="flex h-screen">
      <LocaleSync userLocale={user?.locale ?? "fr"} />
      <AppSidebar officeId={officeId} isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-end border-b px-4">
          <UserMenu
            memberships={memberships.map((m) => ({
              officeId: m.office.id,
              officeName: m.office.name,
            }))}
            currentOfficeId={officeId}
          />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
