import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalSession, getUserMemberships } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const session = await getOptionalSession();

  if (!session) {
    redirect("/sign-in");
  }

  const t = await getTranslations();
  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { defaultOfficeId: true },
    }),
    getUserMemberships(session.user.id),
  ]);

  if (memberships.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t('home.noOfficeTitle')}</h1>
          <p className="mt-2 text-muted-foreground">
            {t('home.noOfficeDescription')}
          </p>
        </div>
      </div>
    );
  }

  // Priority: cookie (last visited) > defaultOfficeId (user pref) > first membership
  const store = await cookies();
  const cookieId = store.get("officeId")?.value;
  const defaultId = user?.defaultOfficeId;
  const ids = [cookieId, defaultId, memberships[0].office.id];
  const targetOffice = ids.find((id) => id && memberships.some((m) => m.office.id === id))!;

  redirect(`/org/${targetOffice}/dashboard`);
}
