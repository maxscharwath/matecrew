import { getTranslations, getLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { buildCostingLedger } from "@/lib/costing";
import { roundCents } from "@/lib/money";
import { DataPagination } from "@/components/pagination";
import { SignedMoney } from "@/components/signed-money";
import { SignedQty } from "@/components/signed-qty";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 10;

export function CountHistoryFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </CardContent>
    </Card>
  );
}

interface Props {
  readonly officeId: string;
  readonly page: number;
}

export async function CountHistorySection({ officeId, page }: Props) {
  const t = await getTranslations();
  const locale = await getLocale();

  // The ledger depends on nothing here, so it shares the round trip.
  const [counts, total, ledger] = await Promise.all([
    prisma.stockCount.findMany({
      where: { officeId },
      orderBy: { countedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        countedBy: { select: { name: true } },
        lines: { include: { item: { select: { name: true } } } },
      },
    }),
    prisma.stockCount.count({ where: { officeId } }),
    buildCostingLedger(officeId),
  ]);

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("inventory.history")}</CardTitle>
          <CardDescription>{t("inventory.historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("inventory.noCounts")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Read the francs the settlement actually charged for each gap, rather than
  // re-deriving them from a price: a gap bigger than the item's own stock is
  // partly billed at the office rate, so recomputing would quote the admin a
  // different number here than on their invoice.
  const shrinkage = new Map<string, number>();
  for (const draw of ledger.draws) {
    if (draw.kind === "SHRINKAGE") shrinkage.set(draw.sourceId, draw.cost);
  }

  const rows = counts.map((count) => {
    const gaps = count.lines.filter((l) => l.delta !== 0);
    const value = gaps.reduce((sum, l) => sum + (shrinkage.get(l.id) ?? 0), 0);
    return {
      id: count.id,
      countedAt: count.countedAt,
      countedBy: count.countedBy.name,
      note: count.note,
      value: roundCents(value),
      gaps: gaps.map((l) => ({
        itemName: l.item.name,
        expectedQty: l.expectedQty,
        countedQty: l.countedQty,
        delta: l.delta,
      })),
    };
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("inventory.history")}</CardTitle>
          <CardDescription>{t("inventory.historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("inventory.date")}</TableHead>
                <TableHead>{t("inventory.countedBy")}</TableHead>
                <TableHead>{t("inventory.gap")}</TableHead>
                <TableHead className="text-right">
                  {t("inventory.gapValue")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap align-top">
                    {row.countedAt.toLocaleDateString(locale, {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="align-top">{row.countedBy}</TableCell>
                  <TableCell className="align-top">
                    {row.gaps.length === 0 ? (
                      <Badge variant="outline">{t("inventory.noGap")}</Badge>
                    ) : (
                      <div className="space-y-0.5 text-sm">
                        {row.gaps.map((gap) => (
                          <div key={gap.itemName} className="tabular-nums">
                            <span className="font-medium">{gap.itemName}</span>{" "}
                            <SignedQty value={gap.delta} />{" "}
                            <span className="text-muted-foreground">
                              ({gap.expectedQty} → {gap.countedQty})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {row.note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.note}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <SignedMoney value={row.value} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <DataPagination totalItems={total} pageSize={PAGE_SIZE} />
    </div>
  );
}
