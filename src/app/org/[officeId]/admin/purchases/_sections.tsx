import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { PurchaseList } from "@/components/purchase-list";
import { PurchasePriceChart, type PriceSeries } from "@/components/purchase-price-chart";
import { DataPagination } from "@/components/pagination";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 20;

// ── Skeleton fallback ────────────────────────────────────

export function PurchaseListFallback() {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border px-3 py-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-1 h-3 w-28" />
                </div>
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function PriceHistoryFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

// ── Async section ────────────────────────────────────────

interface Props {
  readonly officeId: string;
  readonly page: number;
}

export async function PurchaseListSection({ officeId, page }: Props) {
  const [batches, batchCount] = await Promise.all([
    prisma.purchaseBatch.findMany({
      where: { officeId },
      orderBy: { purchasedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        paidBy: { select: { name: true, image: true } },
        invoices: { select: { id: true, filename: true } },
        lines: {
          include: { item: { select: { name: true } } },
        },
      },
    }),
    prisma.purchaseBatch.count({ where: { officeId } }),
  ]);

  const serializedBatches = await Promise.all(
    batches.map(async (b) => ({
      id: b.id,
      status: b.status as "ORDERED" | "DELIVERED",
      purchasedAt: b.purchasedAt.toISOString(),
      totalQty: b.lines.reduce((sum, l) => sum + l.qty, 0),
      lines: b.lines.map((l) => ({
        itemName: l.item.name,
        qty: l.qty,
        unitPrice: l.unitPrice.toNumber(),
      })),
      totalPrice: b.totalPrice.toNumber(),
      paidByName: b.paidBy.name,
      paidByImage: resolveAvatarUrl(b.paidBy.image),
      notes: b.notes,
      invoices: b.invoices,
    })),
  );

  return (
    <div className="space-y-3">
      <PurchaseList officeId={officeId} batches={serializedBatches} />
      <DataPagination totalItems={batchCount} pageSize={PAGE_SIZE} />
    </div>
  );
}

/** The chart palette has 6 fixed slots — never cycled (colors follow items). */
const MAX_CHART_SERIES = 6;

export async function PriceHistorySection({ officeId }: { readonly officeId: string }) {
  const t = await getTranslations();

  const lines = await prisma.purchaseLine.findMany({
    where: { batch: { officeId } },
    select: {
      itemId: true,
      qty: true,
      lineTotal: true,
      item: { select: { name: true, sortOrder: true } },
      batch: { select: { id: true, purchasedAt: true } },
    },
    orderBy: [{ batch: { purchasedAt: "asc" } }, { batch: { id: "asc" } }],
  });

  if (lines.length === 0) return null;

  // X axis: one slot per order, ascending.
  const batchIds: string[] = [];
  const batchIndex = new Map<string, number>();
  const dates: string[] = [];
  for (const l of lines) {
    if (!batchIndex.has(l.batch.id)) {
      batchIndex.set(l.batch.id, batchIds.length);
      batchIds.push(l.batch.id);
      dates.push(l.batch.purchasedAt.toISOString());
    }
  }

  // One series per item, in the office's stable item order.
  const itemOrder = new Map<string, { name: string; sortOrder: number }>();
  for (const l of lines) {
    if (!itemOrder.has(l.itemId)) itemOrder.set(l.itemId, l.item);
  }
  const itemIds = [...itemOrder.keys()].sort((a, b) => {
    const ia = itemOrder.get(a)!;
    const ib = itemOrder.get(b)!;
    return ia.sortOrder - ib.sortOrder || ia.name.localeCompare(ib.name);
  });

  const series: PriceSeries[] = itemIds
    .slice(0, MAX_CHART_SERIES)
    .map((itemId) => {
      // Per order: spend and qty for this item (an order can have several
      // lines of the same item), plus the cumulative weighted average.
      const spendAt = new Array<number>(batchIds.length).fill(0);
      const qtyAt = new Array<number>(batchIds.length).fill(0);
      for (const l of lines) {
        if (l.itemId !== itemId) continue;
        const idx = batchIndex.get(l.batch.id)!;
        spendAt[idx] += l.lineTotal.toNumber();
        qtyAt[idx] += l.qty;
      }

      const prices: (number | null)[] = [];
      const runningAvg: (number | null)[] = [];
      let cumSpend = 0;
      let cumQty = 0;
      for (let i = 0; i < batchIds.length; i++) {
        if (qtyAt[i] > 0) {
          cumSpend += spendAt[i];
          cumQty += qtyAt[i];
          prices.push(Math.round((spendAt[i] / qtyAt[i]) * 100) / 100);
          runningAvg.push(Math.round((cumSpend / cumQty) * 100) / 100);
        } else {
          prices.push(null);
          runningAvg.push(null);
        }
      }

      return { itemName: itemOrder.get(itemId)!.name, prices, runningAvg };
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("purchases.priceHistory")}</CardTitle>
        <CardDescription>{t("purchases.priceHistoryDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <PurchasePriceChart
          dates={dates}
          series={series}
          avgLabel={t("purchases.runningAvg")}
        />
      </CardContent>
    </Card>
  );
}
