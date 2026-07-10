import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getActiveItems } from "@/lib/items";
import { StockCard } from "@/components/stock-card";
import { getTranslations } from "next-intl/server";
import {
  StockChartSection,
  StockChartFallback,
  StockPredictionSection,
  StockPredictionFallback,
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

  const [office, items] = await Promise.all([
    prisma.office.findUniqueOrThrow({
      where: { id: officeId },
      select: { name: true, lowStockThreshold: true },
    }),
    getActiveItems(officeId),
  ]);

  const currentQty = items.reduce((sum, i) => sum + i.stockQty, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('stock.title', { office: office.name })}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('stock.subtitle')}
        </p>
      </div>

      <div className="space-y-4">
        {items.map((item) => (
          <StockCard
            key={item.id}
            officeId={officeId}
            itemId={item.id}
            itemName={item.name}
            currentQty={item.stockQty}
            lowStockThreshold={office.lowStockThreshold}
          />
        ))}
      </div>

      <Suspense fallback={<StockPredictionFallback />}>
        <StockPredictionSection
          officeId={officeId}
          currentQty={currentQty}
          lowStockThreshold={office.lowStockThreshold}
        />
      </Suspense>

      <Suspense fallback={<StockChartFallback />}>
        <StockChartSection officeId={officeId} officeName={office.name} />
      </Suspense>

      <Suspense fallback={<AuditLogFallback />}>
        <AuditLogSection officeId={officeId} page={page} />
      </Suspense>
    </div>
  );
}
