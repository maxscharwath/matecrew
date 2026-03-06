import { getTranslations } from "next-intl/server";
import { requireSession, getUserMemberships } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const session = await requireSession();
  const t = await getTranslations();

  const [user, memberships] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true, locale: true, defaultOfficeId: true },
    }),
    getUserMemberships(session.user.id),
  ]);

  const avatarUrl = resolveAvatarUrl(user.image);

  const offices = memberships.map((m) => ({
    id: m.office.id,
    name: m.office.name,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("profile.subtitle")}</p>
      </div>
      <ProfileForm user={user} avatarUrl={avatarUrl} offices={offices} />
    </div>
  );
}
