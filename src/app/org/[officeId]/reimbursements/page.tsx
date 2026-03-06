import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth-utils";
import {
  BalanceSection,
  BalanceSectionFallback,
  PreviewSection,
  PreviewSectionFallback,
  HistorySection,
  HistorySectionFallback,
  PeriodsSection,
  PeriodsSectionFallback,
} from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
  readonly searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function UserReimbursementsPage({ params, searchParams }: Props) {
  const { officeId } = await params;
  const sp = await searchParams;
  const consumptionPage = Math.max(1, Number(sp.page) || 1);
  const { session } = await requireMembership(officeId);
  const userId = session.user.id;
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('reimbursements.userTitle')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('reimbursements.userSubtitle')}
        </p>
      </div>

      <Suspense fallback={<BalanceSectionFallback />}>
        <BalanceSection officeId={officeId} userId={userId} />
      </Suspense>

      <Suspense fallback={<PreviewSectionFallback />}>
        <PreviewSection officeId={officeId} userId={userId} />
      </Suspense>

      <Suspense fallback={<HistorySectionFallback />}>
        <HistorySection officeId={officeId} userId={userId} page={consumptionPage} />
      </Suspense>

      <Suspense fallback={<PeriodsSectionFallback />}>
        <PeriodsSection officeId={officeId} userId={userId} />
      </Suspense>
    </div>
  );
}
