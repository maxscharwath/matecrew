import { requireMembership, getUserMemberships } from "@/lib/auth-utils";
import { resolveAvatarUrl } from "@/lib/r2-helpers";
import { AppSidebar } from "@/components/app-sidebar";
import { OfficeCookie } from "@/components/office-cookie";
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
  const avatarUrl = await resolveAvatarUrl(membership.user.image);

  return (
    <div className="flex h-screen">
      <OfficeCookie officeId={officeId} />
      <LocaleSync userLocale={membership.user.locale ?? "fr"} />
      <AppSidebar officeId={officeId} isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-end border-b px-4">
          <UserMenu
            memberships={memberships.map((m) => ({
              officeId: m.office.id,
              officeName: m.office.name,
            }))}
            currentOfficeId={officeId}
            avatarUrl={avatarUrl}
          />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
