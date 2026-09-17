import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getActiveItems } from "@/lib/items";
import { effectiveLowStockThreshold } from "@/lib/stock";
import { toIdList } from "@/lib/search-params";
import { StockManager } from "@/components/stock-manager";
import { getTranslations } from "next-intl/server";
import {
  StockChartSection,
  StockChartFallback,
  StockPredictionSection,
  StockPredictionFallback,
  CountHistorySection,
  CountHistoryFallback,
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
  // The two history tables share this screen, so each paginates on its own key.
  const countPage = Math.max(1, Number(sp.count) || 1);
  const userIds = toIdList(sp.user);
  const itemIds = toIdList(sp.item);
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const [office, items] = await Promise.all([
    prisma.office.findUniqueOrThrow({
      where: { id: officeId },
      select: { name: true, lowStockThreshold: true },
    }),
    getActiveItems(officeId),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('stock.title', { office: office.name })}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('stock.subtitle')}
        </p>
      </div>

      <StockManager
        officeId={officeId}
        officeThreshold={office.lowStockThreshold}
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          currentQty: i.stockQty,
          lowStockThreshold: effectiveLowStockThreshold(
            i.lowStockThreshold,
            office.lowStockThreshold,
          ),
          ownThreshold: i.lowStockThreshold,
        }))}
      />

      <Suspense fallback={<StockPredictionFallback />}>
        <StockPredictionSection officeId={officeId} />
      </Suspense>

      <Suspense fallback={<StockChartFallback />}>
        <StockChartSection officeId={officeId} />
      </Suspense>

      <Suspense fallback={<CountHistoryFallback />}>
        <CountHistorySection officeId={officeId} page={countPage} />
      </Suspense>

      <Suspense fallback={<AuditLogFallback />}>
        <AuditLogSection
          officeId={officeId}
          page={page}
          userIds={userIds}
          itemIds={itemIds}
        />
      </Suspense>
    </div>
  );
}
