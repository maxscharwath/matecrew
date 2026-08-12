import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth-utils";
import {
  PendingPaymentsSection,
  PendingPaymentsSectionFallback,
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

      {/* Anything actionable comes first, and it is what the unpaid-invoices
          banner anchors to. */}
      {/* Clears the sticky banner + header stack, which is taller on mobile
          where the banner text wraps. */}
      <div id="pending-payments" className="scroll-mt-48 md:scroll-mt-40">
        <Suspense fallback={<PendingPaymentsSectionFallback />}>
          <PendingPaymentsSection officeId={officeId} userId={userId} />
        </Suspense>
      </div>

      <Suspense fallback={<PreviewSectionFallback />}>
        <PreviewSection officeId={officeId} userId={userId} />
      </Suspense>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t('reimbursements.periodHistoryTitle')}
        </h2>
        <Suspense fallback={<PeriodsSectionFallback />}>
          <PeriodsSection officeId={officeId} userId={userId} />
        </Suspense>
      </section>

      <Suspense fallback={<HistorySectionFallback />}>
        <HistorySection officeId={officeId} userId={userId} page={consumptionPage} />
      </Suspense>
    </div>
  );
}
