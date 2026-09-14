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
import { TableFilter } from "@/components/table-filter";
import { ConsumptionSwapButton } from "@/components/consumption-swap-button";
import { getActiveItems } from "@/lib/items";
import { toISODateString } from "@/lib/date";

const PAGE_SIZE = 20;

/** Civil day in the office's timezone, as YYYY-MM-DD, for comparing an
 *  instant against a date-only column. */
function zurichDay(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

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
  readonly userIds: readonly string[];
  readonly sources: readonly string[];
}

/** The two ways a can leaves the fridge, labelled as the rest of the app does. */
const SOURCES = ["DAILY_REQUEST", "MANUAL"] as const;
type Source = (typeof SOURCES)[number];

/**
 * Every consumption in the office, whoever drank it and however it was
 * recorded — a served daily request, a can taken on the spot, or an admin
 * backfill. Filter by member to see one person's whole history.
 */
export async function ConsumptionListSection({
  officeId,
  page,
  userIds,
  sources,
}: Props) {
  const t = await getTranslations();

  const sourceLabel: Record<Source, string> = {
    DAILY_REQUEST: t("dashboard.dailyRequest"),
    MANUAL: t("dashboard.selfServe"),
  };

  // Cancelled entries are reversed consumption: they bill nobody, so they are
  // not part of "what this person drank".
  const listed = { officeId, cancelledAt: null };
  const picked = sources.filter((s): s is Source =>
    SOURCES.includes(s as Source),
  );
  const where = {
    ...listed,
    ...(userIds.length > 0 ? { userId: { in: [...userIds] } } : {}),
    ...(picked.length > 0 ? { source: { in: picked } } : {}),
  };

  const [entries, total, listedMembers, listedSources, items] = await Promise.all([
    prisma.consumptionEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { name: true } },
        item: { select: { name: true } },
      },
    }),
    prisma.consumptionEntry.count({ where }),
    // Both filters only offer values that occur in this office, so no
    // combination of boxes can point at consumptions that never happened.
    prisma.consumptionEntry.findMany({
      where: listed,
      distinct: ["userId"],
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.consumptionEntry.findMany({
      where: listed,
      distinct: ["source"],
      select: { source: true },
    }),
    // The items a consumption can be re-pointed at. Archived ones are left out:
    // a correction should not resurrect a de-listed product.
    getActiveItems(officeId),
  ]);

  const swapItems = items.map((i) => ({
    id: i.id,
    name: i.name,
    stockQty: i.stockQty,
  }));

  const members = listedMembers
    .map((e) => e.user)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const sourceOptions = SOURCES.filter((s) =>
    listedSources.some((e) => e.source === s),
  ).map((s) => ({ id: s, name: sourceLabel[s] }));

  if (members.length === 0) {
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
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("bulkConsumption.allEntries")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter
              options={sourceOptions}
              selected={sources}
              param="source"
              icon="source"
              label={t("bulkConsumption.filterBySource")}
              allLabel={t("bulkConsumption.allSources")}
            />
            <TableFilter
              options={members}
              selected={userIds}
              param="user"
              icon="user"
              label={t("bulkConsumption.filterByMember")}
              allLabel={t("bulkConsumption.allMembers")}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bulkConsumption.member")}</TableHead>
                <TableHead>{t("bulkConsumption.item")}</TableHead>
                <TableHead>{t("bulkConsumption.source")}</TableHead>
                <TableHead>{t("bulkConsumption.date")}</TableHead>
                <TableHead>{t("bulkConsumption.qty")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    {t("bulkConsumption.noEntriesForFilter")}
                  </TableCell>
                </TableRow>
              )}
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {entry.user.name}
                  </TableCell>
                  <TableCell>
                    <ConsumptionSwapButton
                      officeId={officeId}
                      entry={{
                        id: entry.id,
                        itemId: entry.itemId,
                        itemName: entry.item.name,
                        memberName: entry.user.name,
                        qty: entry.qty,
                        date: entry.date.toLocaleDateString("fr-CH", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          timeZone: "UTC",
                        }),
                      }}
                      items={swapItems}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">
                      {sourceLabel[entry.source as Source]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entry.createdAt.toLocaleString("fr-CH", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Zurich",
                    })}
                    {/* A backfilled entry is billed to a day other than the one
                        it was typed on, so the timestamp alone would name the
                        wrong day. */}
                    {toISODateString(entry.date) !==
                      zurichDay(entry.createdAt) && (
                      <span className="block text-xs text-muted-foreground">
                        {t("bulkConsumption.consumedOn", {
                          date: entry.date.toLocaleDateString("fr-CH", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            timeZone: "UTC",
                          }),
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.qty}</Badge>
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
