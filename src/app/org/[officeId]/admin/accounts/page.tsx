import { Suspense } from "react";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";
import { DuplicatesSection, DuplicatesFallback } from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function AccountsPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("accounts.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("accounts.subtitle")}</p>
      </div>

      <Suspense fallback={<DuplicatesFallback />}>
        <DuplicatesSection officeId={officeId} />
      </Suspense>
    </div>
  );
}
