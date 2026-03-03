import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalSession, getUserMemberships } from "@/lib/auth-utils";

export default async function Home() {
  const session = await getOptionalSession();

  if (!session) {
    redirect("/sign-in");
  }

  const t = await getTranslations();
  const memberships = await getUserMemberships(session.user.id);

  if (memberships.length === 0) {
    // User has no memberships — show a basic message
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

  redirect(`/org/${memberships[0].office.id}/dashboard`);
}
