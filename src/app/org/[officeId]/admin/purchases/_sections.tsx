import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/storage";
import { PurchaseList } from "@/components/purchase-list";
import { DataPagination } from "@/components/pagination";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
      },
    }),
    prisma.purchaseBatch.count({ where: { officeId } }),
  ]);

  const serializedBatches = await Promise.all(
    batches.map(async (b) => ({
      id: b.id,
      status: b.status as "ORDERED" | "DELIVERED",
      purchasedAt: b.purchasedAt.toISOString(),
      qty: b.qty,
      unitPrice: b.unitPrice.toNumber(),
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
