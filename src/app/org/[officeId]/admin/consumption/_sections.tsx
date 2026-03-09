import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";
import { DataPagination } from "@/components/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 20;

export function ConsumptionListFallback() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-md border px-3 py-3"
          >
            <Skeleton className="h-4 w-60" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

interface Props {
  readonly officeId: string;
  readonly page: number;
}

export async function ConsumptionListSection({ officeId, page }: Props) {
  const t = await getTranslations();

  const [entries, total] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where: { officeId, source: "MANUAL", cancelledAt: null },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { name: true } },
      },
    }),
    prisma.consumptionEntry.count({
      where: { officeId, source: "MANUAL", cancelledAt: null },
    }),
  ]);

  if (total === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t("bulkConsumption.noEntries")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>{t("bulkConsumption.recentEntries")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bulkConsumption.member")}</TableHead>
                <TableHead>{t("bulkConsumption.date")}</TableHead>
                <TableHead>{t("bulkConsumption.qty")}</TableHead>
                <TableHead>{t("bulkConsumption.createdAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {entry.user.name}
                  </TableCell>
                  <TableCell>
                    {entry.date.toLocaleDateString("fr-CH")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.qty}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.createdAt.toLocaleDateString("fr-CH")}
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
