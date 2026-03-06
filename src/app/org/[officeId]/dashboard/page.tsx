import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth-utils";
import {
  HeroSection,
  HeroSectionFallback,
  TodaySection,
  TodaySectionFallback,
  StatsAndFinancialsSection,
  StatsSectionFallback,
  SettlementSection,
  SettlementSectionFallback,
  RecentRequestsSection,
  RecentRequestsFallback,
} from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function DashboardPage({ params }: Props) {
  const { officeId } = await params;
  const { session, membership } = await requireMembership(officeId);
  const t = await getTranslations();
  const userId = session.user.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('dashboard.welcome', { name: session.user.name, office: membership.office.name })}
        </p>
      </div>

      <Suspense fallback={<HeroSectionFallback />}>
        <HeroSection officeId={officeId} />
      </Suspense>

      <Suspense fallback={<TodaySectionFallback />}>
        <TodaySection officeId={officeId} userId={userId} />
      </Suspense>

      <Suspense fallback={<StatsSectionFallback />}>
        <StatsAndFinancialsSection officeId={officeId} userId={userId} />
      </Suspense>

      <Suspense fallback={<SettlementSectionFallback />}>
        <SettlementSection officeId={officeId} userId={userId} />
      </Suspense>

      <Suspense fallback={<RecentRequestsFallback />}>
        <RecentRequestsSection officeId={officeId} userId={userId} />
      </Suspense>
    </div>
  );
}
