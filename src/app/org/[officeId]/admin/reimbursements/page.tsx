import { Suspense } from "react";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getLocale, getTranslations } from "next-intl/server";
import { GenerateMissingPeriodsButton } from "./generate-button";
import {
  OutstandingSection,
  OutstandingSectionFallback,
  PeriodsSection,
  PeriodsSectionFallback,
} from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

// The manual statement send and the reminder run inside this segment's
// request, and a PDF per member takes longer than the default window allows.
export const maxDuration = 60;

export default async function ReimbursementsPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('reimbursements.adminTitle')}</h1>
          <p className="mt-1 text-muted-foreground">
            {t('reimbursements.adminSubtitle')}
          </p>
        </div>
        <GenerateMissingPeriodsButton officeId={officeId} />
      </div>

      <Suspense fallback={<OutstandingSectionFallback />}>
        <OutstandingSection officeId={officeId} locale={locale} />
      </Suspense>

      <Suspense fallback={<PeriodsSectionFallback />}>
        <PeriodsSection officeId={officeId} />
      </Suspense>
    </div>
  );
}
