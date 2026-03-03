import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { requireSession, getUserMemberships } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/r2-helpers";
import { UserMenu } from "@/components/user-menu";
import { LocaleSync } from "@/components/locale-sync";

interface Props {
  readonly children: React.ReactNode;
}

export default async function ProfileLayout({ children }: Props) {
  const session = await requireSession();
  const memberships = await getUserMemberships(session.user.id);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { locale: true, image: true },
  });

  const avatarUrl = await resolveAvatarUrl(user?.image);
  const store = await cookies();
  const lastOfficeId = store.get("officeId")?.value ?? memberships[0]?.office.id;

  return (
    <div className="flex h-screen flex-col">
      <LocaleSync userLocale={user?.locale ?? "fr"} />
      <header className="flex h-14 items-center justify-between border-b px-4">
        {lastOfficeId ? (
          <Link
            href={`/org/${lastOfficeId}/dashboard`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            MateCrew
          </Link>
        ) : (
          <span />
        )}
        <UserMenu
          memberships={memberships.map((m) => ({
            officeId: m.office.id,
            officeName: m.office.name,
          }))}
          currentOfficeId={lastOfficeId ?? ""}
          avatarUrl={avatarUrl}
        />
      </header>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
