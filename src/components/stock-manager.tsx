"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AlertTriangle, BellRing, Boxes, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SignedQty } from "@/components/signed-qty";
import { gapOf } from "@/lib/stock-gaps";
import { cn } from "@/lib/utils";
import { saveShelf } from "@/app/org/[officeId]/admin/stock/actions";

export interface StockManagerItem {
  id: string;
  name: string;
  currentQty: number;
  /** The threshold in force: the item's own, or the office's. */
  lowStockThreshold: number;
  /** The item's own threshold; null means it follows the office. */
  ownThreshold: number | null;
}

interface StockManagerProps {
  readonly officeId: string;
  readonly items: readonly StockManagerItem[];
  readonly officeThreshold: number;
}

/** What a row's gap means: billed to the drinkers, or free. */
type GapMode = "LOSS" | "CORRECTION";

/** Empty means "follow the office", so an inherited threshold shows blank. */
function asField(value: number | null) {
  return value === null ? "" : String(value);
}

/**
 * One list of what is on the shelf, and one way to change it: type the real
 * quantity, retune what counts as low, press save.
 *
 * Adjusting and counting used to be two screens printing the same items with
 * the same numbers — so the fridge was described twice and the descriptions
 * could disagree. They are the same act: set the quantity to what is really
 * there. All that differs is whether the gap is billed, and each row says that
 * for itself.
 */
export function StockManager({
  officeId,
  items,
  officeThreshold,
}: StockManagerProps) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();

  const [counted, setCounted] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, asField(i.ownThreshold)])),
  );
  const [modes, setModes] = useState<Record<string, GapMode>>({});
  const [note, setNote] = useState("");

  // Re-sync when the shelf changes under us — a round served, another admin —
  // rather than leaving stale numbers in fields that look authoritative.
  const savedThresholds = items.map((i) => `${i.id}:${i.ownThreshold}`).join("|");
  const [lastSaved, setLastSaved] = useState(savedThresholds);
  if (lastSaved !== savedThresholds) {
    setLastSaved(savedThresholds);
    setThresholds(
      Object.fromEntries(items.map((i) => [i.id, asField(i.ownThreshold)])),
    );
  }

  const rows = items.map((item) => {
    const typed = counted[item.id];
    const value = typed?.trim() ? Number(typed) : null;
    const valid = value !== null && Number.isInteger(value) && value >= 0;
    return {
      item,
      value: valid ? value : null,
      delta: valid ? gapOf(item.currentQty, value) : null,
      threshold: thresholds[item.id] ?? "",
      // Loss by default: a gap nobody explains is shrinkage, and pretending
      // otherwise silently moves the cost onto whoever bought the last order.
      mode: modes[item.id] ?? "LOSS",
    };
  });

  const quantityChanges = rows.flatMap((r) =>
    r.value !== null && r.delta !== null
      ? [{ itemId: r.item.id, qty: r.value, delta: r.delta, mode: r.mode }]
      : [],
  );
  const thresholdChanges = rows.flatMap((r) => {
    const typed = r.threshold.trim();
    if (typed === asField(r.item.ownThreshold)) return [];
    const next = typed === "" ? null : Number(typed);
    if (next !== null && (!Number.isInteger(next) || next < 0)) return [];
    return [{ itemId: r.item.id, threshold: next }];
  });
  const cansIn = (mode: GapMode) =>
    quantityChanges
      .filter((q) => q.mode === mode)
      .reduce((sum, q) => sum + Math.abs(q.delta), 0);
  const pendingBilled = cansIn("LOSS");
  const pendingCorrected = cansIn("CORRECTION");
  const dirty = quantityChanges.length > 0 || thresholdChanges.length > 0;

  /** The same sentence in the footer before saving and in the toast after. */
  function summarize(billed: number, corrected: number, thresholdCount: number) {
    const parts = [];
    if (billed > 0) parts.push(t("stock.summaryBilled", { count: billed }));
    if (corrected > 0) parts.push(t("stock.summaryCorrected", { count: corrected }));
    if (thresholdCount > 0)
      parts.push(t("stock.summaryThresholds", { count: thresholdCount }));
    return parts.join(" · ");
  }

  function save() {
    const formData = new FormData();
    formData.set(
      "payload",
      JSON.stringify({
        quantities: quantityChanges.map((q) => ({
          itemId: q.itemId,
          qty: q.qty,
          mode: q.mode,
        })),
        thresholds: thresholdChanges,
        note,
      }),
    );
    startTransition(async () => {
      const result = await saveShelf(officeId, formData);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        summarize(result.billed, result.corrected, result.thresholds) ||
          t("stock.saved"),
      );
      setCounted({});
      setModes({});
      setNote("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="size-4" />
          {t("stock.manageTitle")}
        </CardTitle>
        <CardDescription>{t("stock.manageDescription")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-1">
        {/* One grid, so every row's fields line up into columns rather than
            drifting with the length of an item's name. */}
        <div className="hidden px-3 pb-1 text-xs uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_8rem_3.5rem_10rem_8rem] lg:items-center lg:gap-3">
          <span>{t("stock.item")}</span>
          <span>{t("stock.realQty")}</span>
          <span className="text-right">{t("stock.gap")}</span>
          <span>{t("stock.gapKind")}</span>
          <span>{t("stock.thresholdLabel")}</span>
        </div>

        {rows.map(({ item, delta, threshold, mode }) => {
          const isLow = item.currentQty <= item.lowStockThreshold;
          return (
            <div
              key={item.id}
              className="grid grid-cols-1 gap-3 rounded-md px-3 py-2 hover:bg-muted/40 lg:grid-cols-[minmax(0,1fr)_8rem_3.5rem_10rem_8rem] lg:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-medium leading-tight">{item.name}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span
                    className={cn(
                      "text-sm tabular-nums text-muted-foreground",
                      isLow && "text-destructive",
                    )}
                  >
                    {t("stock.inStock", { qty: item.currentQty })}
                  </span>
                  {isLow && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" />
                      {t("stock.low")}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Left blank, the row is not touched at all. */}
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={t("inventory.countedFor", { item: item.name })}
                className="text-right tabular-nums"
                placeholder={String(item.currentQty)}
                value={counted[item.id] ?? ""}
                disabled={isPending}
                onChange={(e) =>
                  setCounted((prev) => ({ ...prev, [item.id]: e.target.value }))
                }
              />

              {/* Zero rather than a dash on an untouched row: the gap between
                  what is on the shelf and what the app believes really is zero
                  until something is typed. */}
              <SignedQty
                value={delta ?? 0}
                className="text-right text-sm font-medium tabular-nums"
              />

              {/* Per item, because one count is rarely one story: the mint
                  really did run dry while the classic was just miscounted. */}
              <Select
                value={mode}
                disabled={isPending}
                onValueChange={(v) =>
                  setModes((prev) => ({ ...prev, [item.id]: v as GapMode }))
                }
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={t("stock.gapKindFor", { item: item.name })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOSS">{t("stock.modeLoss")}</SelectItem>
                  <SelectItem value="CORRECTION">
                    {t("stock.modeAdjustment")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <InputGroup title={t("stock.thresholdHint", { qty: officeThreshold })}>
                <InputGroupAddon>
                  <BellRing />
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={t("stock.thresholdFor", { item: item.name })}
                  className="text-right tabular-nums"
                  value={threshold}
                  placeholder={String(officeThreshold)}
                  disabled={isPending}
                  onChange={(e) =>
                    setThresholds((prev) => ({
                      ...prev,
                      [item.id]: e.target.value,
                    }))
                  }
                />
              </InputGroup>
            </div>
          );
        })}

        <InputGroup className="mt-3">
          <InputGroupAddon>
            <InputGroupText>{t("inventory.note")}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            name="note"
            placeholder={t("inventory.notePlaceholder")}
            value={note}
            disabled={isPending}
            onChange={(e) => setNote(e.target.value)}
          />
        </InputGroup>
      </CardContent>

      <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {dirty
            ? summarize(pendingBilled, pendingCorrected, thresholdChanges.length)
            : t("stock.nothingChanged")}
        </p>
        <Button type="button" disabled={!dirty || isPending} onClick={save}>
          <Save />
          {isPending ? t("stock.saving") : t("stock.save")}
        </Button>
      </CardFooter>
    </Card>
  );
}
