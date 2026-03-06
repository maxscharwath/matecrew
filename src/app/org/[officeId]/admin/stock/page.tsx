import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { StockCard } from "@/components/stock-card";
import { getTranslations } from "next-intl/server";
import {
  StockChartSection,
  StockChartFallback,
  AuditLogSection,
  AuditLogFallback,
} from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
  readonly searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StockPage({ params, searchParams }: Props) {
  const { officeId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    include: { stock: true },
  });

  const currentQty = office.stock?.currentQty ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('stock.title', { office: office.name })}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('stock.subtitle')}
        </p>
      </div>

      <StockCard
        officeId={officeId}
        officeName={office.name}
        currentQty={currentQty}
        lowStockThreshold={office.lowStockThreshold}
      />

      <Suspense fallback={<StockChartFallback />}>
        <StockChartSection
          officeId={officeId}
          officeName={office.name}
          currentQty={currentQty}
        />
      </Suspense>

      <Suspense fallback={<AuditLogFallback />}>
        <AuditLogSection officeId={officeId} page={page} />
      </Suspense>
    </div>
  );
}
