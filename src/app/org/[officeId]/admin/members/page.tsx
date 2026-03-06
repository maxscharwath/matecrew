import { Suspense } from "react";
import { requireOrgRoles } from "@/lib/auth-utils";
import { AddMemberForm } from "@/components/add-member-form";
import { getTranslations } from "next-intl/server";
import {
  PendingRequestsSection,
  PendingRequestsFallback,
  MembersTableSection,
  MembersTableFallback,
} from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
  readonly searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MembersPage({ params, searchParams }: Props) {
  const { officeId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { session } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("members.title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("members.subtitle")}
        </p>
      </div>

      <Suspense fallback={<PendingRequestsFallback />}>
        <PendingRequestsSection officeId={officeId} />
      </Suspense>

      <AddMemberForm officeId={officeId} />

      <Suspense fallback={<MembersTableFallback />}>
        <MembersTableSection
          officeId={officeId}
          currentUserId={session.user.id}
          page={page}
        />
      </Suspense>
    </div>
  );
}
