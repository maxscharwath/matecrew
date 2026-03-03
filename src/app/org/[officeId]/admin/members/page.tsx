import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { resolveAvatarUrl } from "@/lib/r2-helpers";
import { MembersTable } from "@/components/members-table";
import { AddMemberForm } from "@/components/add-member-form";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function MembersPage({ params }: Props) {
  const { officeId } = await params;
  const { session } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const memberships = await prisma.membership.findMany({
    where: { officeId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { user: { name: "asc" } },
  });

  const members = await Promise.all(
    memberships.map(async (m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: await resolveAvatarUrl(m.user.image),
      roles: m.roles as ("ADMIN" | "USER")[],
    }))
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-bold">{t("members.title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("members.subtitle")}
        </p>
      </div>

      <AddMemberForm officeId={officeId} />
      <MembersTable
        officeId={officeId}
        members={members}
        currentUserId={session.user.id}
      />
    </div>
  );
}
