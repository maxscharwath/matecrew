"use client";

import { useTransition, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createPurchaseBatch } from "@/app/org/[officeId]/admin/purchases/actions";

interface Member {
  userId: string;
  name: string;
}

interface Item {
  id: string;
  name: string;
}

interface PurchaseFormProps {
  readonly officeId: string;
  readonly members: Member[];
  readonly items: Item[];
}

interface LineRow {
  id: number;
  itemId: string;
  qty: string;
  total: string;
}

let nextLineId = 1;

export function PurchaseForm({ officeId, members, items }: PurchaseFormProps) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations();
  const defaultItemId = items[0]?.id ?? "";

  const makeLine = (): LineRow => ({
    id: nextLineId++,
    itemId: defaultItemId,
    qty: "",
    total: "",
  });

  const [lines, setLines] = useState<LineRow[]>(() => [makeLine()]);

  function updateLine(id: number, field: keyof LineRow, value: string) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, makeLine()]);
  }

  function removeLine(id: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }

  const validLines = lines.filter(
    (l) => l.itemId && Number(l.qty) > 0 && Number(l.total) > 0,
  );
  const orderTotal = validLines.reduce((sum, l) => sum + Number(l.total), 0);

  function resetForm() {
    formRef.current?.reset();
    setLines([makeLine()]);
  }

  function handleSubmit(formData: FormData) {
    if (validLines.length === 0) {
      toast.error(t("purchases.addAtLeastOneLine"));
      return;
    }
    formData.set(
      "lines",
      JSON.stringify(
        validLines.map((l) => ({
          itemId: l.itemId,
          qty: Number(l.qty),
          total: Number(l.total),
        })),
      ),
    );
    startTransition(async () => {
      const result = await createPurchaseBatch(officeId, formData);
      if (result.success) {
        toast.success(t("purchases.purchaseRecorded"));
        resetForm();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("purchases.newPurchase")}</CardTitle>
        <CardDescription>{t("purchases.newPurchaseDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          {/* Item lines */}
          <div className="space-y-2">
            <Label>{t("purchases.items")}</Label>

            {/* Column headers (aligned to the inputs below) */}
            <div className="hidden items-center gap-2 px-0.5 sm:flex">
              <span className="flex-1 text-xs font-medium text-muted-foreground">
                {t("purchases.item")}
              </span>
              <span className="w-20 text-right text-xs font-medium text-muted-foreground">
                {t("purchases.qty")}
              </span>
              <span className="w-28 text-right text-xs font-medium text-muted-foreground">
                {t("purchases.linePrice")}
              </span>
              <span className="size-9 shrink-0" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              {lines.map((line) => {
                const perUnit =
                  Number(line.qty) > 0 && Number(line.total) > 0
                    ? Number(line.total) / Number(line.qty)
                    : 0;
                return (
                  <div key={line.id} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Select
                        value={line.itemId}
                        onValueChange={(v) => updateLine(line.id, "itemId", v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("purchases.selectItem")} />
                        </SelectTrigger>
                        <SelectContent>
                          {items.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min={1}
                        placeholder={t("purchases.qty")}
                        value={line.qty}
                        onChange={(e) => updateLine(line.id, "qty", e.target.value)}
                        className="text-right tabular-nums"
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder={t("purchases.linePrice")}
                        value={line.total}
                        onChange={(e) => updateLine(line.id, "total", e.target.value)}
                        className="text-right tabular-nums"
                      />
                      {perUnit > 0 && (
                        <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
                          {t("purchases.perUnit", { price: perUnit.toFixed(2) })}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length <= 1}
                      aria-label={t("purchases.removeLine")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="pt-0.5">
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-1 size-4" />
                {t("purchases.addLine")}
              </Button>
            </div>

            {orderTotal > 0 && (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {t("purchases.total")}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {t("purchases.orderTotal", { total: orderTotal.toFixed(2) })}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchasedAt">{t("purchases.date")}</Label>
              <Input
                id="purchasedAt"
                name="purchasedAt"
                type="date"
                required
                defaultValue={new Date().toISOString().split("T")[0]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paidByUserId">{t("purchases.paidBy")}</Label>
              <Select name="paidByUserId" required>
                <SelectTrigger>
                  <SelectValue placeholder={t("purchases.selectMember")} />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoices">{t("purchases.invoice")}</Label>
            <Input
              id="invoices"
              name="invoices"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">{t("purchases.notes")}</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder={t("purchases.notesPlaceholder")}
              rows={2}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? t("purchases.recording") : t("purchases.recordPurchase")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
