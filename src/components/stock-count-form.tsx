"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignedQty } from "@/components/signed-qty";
import { gapOf, summarizeGaps } from "@/lib/stock-gaps";
import { recordCount } from "@/app/org/[officeId]/admin/inventory/actions";

interface CountItem {
  id: string;
  name: string;
  expectedQty: number;
}

interface StockCountFormProps {
  readonly officeId: string;
  readonly items: CountItem[];
}

/**
 * Physical count sheet: one row per item, expected quantity on the left, what
 * is actually on the shelf on the right. The gap is shown live so whoever is
 * counting can recount before committing — submitting bills the missing cans.
 */
export function StockCountForm({ officeId, items }: StockCountFormProps) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations();

  const [counted, setCounted] = useState<Record<string, string>>({});

  const rows = items.map((item) => {
    const raw = counted[item.id];
    const value = raw ? Number(raw) : null;
    return {
      ...item,
      value,
      delta:
        value == null || Number.isNaN(value)
          ? null
          : gapOf(item.expectedQty, value),
    };
  });

  const filledRows = rows.flatMap((r) =>
    r.value != null && r.delta != null ? [{ ...r, value: r.value, delta: r.delta }] : [],
  );
  const { missing, surplus } = summarizeGaps(filledRows);

  function handleSubmit(formData: FormData) {
    formData.set(
      "counts",
      JSON.stringify(
        filledRows.map((r) => ({ itemId: r.id, countedQty: r.value })),
      ),
    );

    startTransition(async () => {
      const result = await recordCount(officeId, formData);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const { missing: lost, surplus: found } = result.result;
      toast.success(
        lost === 0 && found === 0
          ? t("inventory.countMatches")
          : t("inventory.countRecorded", { missing: lost, surplus: found }),
      );
      formRef.current?.reset();
      setCounted({});
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4" />
          {t("inventory.newCount")}
        </CardTitle>
        <CardDescription>{t("inventory.newCountDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {row.name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {t("inventory.expected", { qty: row.expectedQty })}
                </span>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={t("inventory.countedFor", { item: row.name })}
                  placeholder={t("inventory.countedPlaceholder")}
                  className="w-24 shrink-0 text-right tabular-nums"
                  value={counted[row.id] ?? ""}
                  onChange={(e) =>
                    setCounted((prev) => ({ ...prev, [row.id]: e.target.value }))
                  }
                />
                <SignedQty
                  value={row.delta}
                  className="w-14 shrink-0 text-right text-sm font-medium"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="inventory-note">{t("inventory.note")}</Label>
            <Input
              id="inventory-note"
              name="note"
              placeholder={t("inventory.notePlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {filledRows.length === 0
                ? t("inventory.fillToSee")
                : t("inventory.gapSummary", { missing, surplus })}
            </p>
            <Button type="submit" disabled={isPending || filledRows.length === 0}>
              {isPending ? t("inventory.recording") : t("inventory.recordCount")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
