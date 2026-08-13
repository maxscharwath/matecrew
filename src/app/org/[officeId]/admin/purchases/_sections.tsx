import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { buildCostingLedger } from "@/lib/costing";
import { roundCents } from "@/lib/money";
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

  const ledger = await buildCostingLedger(officeId);
  if (ledger.priceHistory.length === 0) return null;

  // X axis: one slot per order, ascending — `priceHistory` is already
  // chronological, so first sighting of a batch is its position.
  const batches: { id: string; at: Date }[] = [];
  // What was actually paid per can, per order and item — several lines of the
  // same item in one order are blended by quantity.
  const paid = new Map<string, { qty: number; spend: number }>();
  const paidKey = (batchId: string, itemId: string) => `${batchId} ${itemId}`;

  for (const p of ledger.priceHistory) {
    if (batches[batches.length - 1]?.id !== p.batchId) {
      batches.push({ id: p.batchId, at: p.at });
    }
    const key = paidKey(p.batchId, p.itemId);
    const acc = paid.get(key) ?? { qty: 0, spend: 0 };
    paid.set(key, { qty: acc.qty + p.qty, spend: acc.spend + p.spend });
  }

  // Items that were bought take the chart's slots first: an item that has only
  // ever been drunk draws as a flat office-blend line, and it must not push a
  // real purchase history off the chart.
  const bought = new Set(ledger.priceHistory.map((p) => p.itemId));
  const items = [...ledger.itemNames].map(([id, name]) => ({ id, name }));
  const series: PriceSeries[] = [
    ...items.filter((i) => bought.has(i.id)),
    ...items.filter((i) => !bought.has(i.id)),
  ]
    .slice(0, MAX_CHART_SERIES)
    .map((item) => {
      // The billing price is defined at every point on the timeline, even
      // before an item was first bought — that is exactly when the office-wide
      // fallback applies. The ledger decides that, so the dashed segments and
      // the invoice can never disagree about what a fallback price is.
      const prices = batches.map((b) => ledger.priceAt(item.id, b.at));
      return {
        itemName: item.name,
        billing: prices.map((p) => roundCents(p.unitCost)),
        estimated: prices.map((p) => p.estimated),
        purchase: batches.map((b) => {
          const line = paid.get(paidKey(b.id, item.id));
          return line ? roundCents(line.spend / line.qty) : null;
        }),
      };
    });

  const dates = batches.map((b) => b.at.toISOString());

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
          billingLabel={t("purchases.billingPrice")}
          paidLabel={t("purchases.paidPrice")}
          estimatedLabel={t("purchases.estimatedPrice")}
        />
      </CardContent>
    </Card>
  );
}
