"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { swapConsumptionItem } from "@/app/org/[officeId]/admin/consumption/actions";

interface SwapItem {
  id: string;
  name: string;
  stockQty: number;
}

interface ConsumptionSwapButtonProps {
  readonly officeId: string;
  readonly entry: {
    id: string;
    itemId: string;
    itemName: string;
    memberName: string;
    qty: number;
    /** Already formatted by the server, which owns the office's locale. */
    date: string;
  };
  readonly items: readonly SwapItem[];
}

/**
 * Corrects what somebody drank: pick another item and the entry, the stock and
 * the settlement all follow. Lives on the row rather than behind a bulk form
 * because the correction is always about one can you can point at.
 *
 * The candidates carry their current stock, so an admin sees before clicking
 * whether the shelf can absorb the swap — the action refuses a count that
 * cannot, and that is the number they need to fix first.
 */
export function ConsumptionSwapButton({
  officeId,
  entry,
  items,
}: ConsumptionSwapButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [isPending, startTransition] = useTransition();

  const candidates = items.filter((i) => i.id !== entry.itemId);

  function handleSwap() {
    if (!targetId) return;
    startTransition(async () => {
      const result = await swapConsumptionItem(officeId, entry.id, targetId);
      if (result.success) {
        toast.success(t("bulkConsumption.swapped", { from: result.from, to: result.to }));
        setOpen(false);
        setTargetId("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={candidates.length === 0}
          title={candidates.length === 0 ? t("bulkConsumption.swapNoOther") : t("bulkConsumption.swap")}
        >
          <ArrowLeftRight className="size-4 text-muted-foreground" />
          <span className="sr-only">{t("bulkConsumption.swap")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("bulkConsumption.swapTitle")}</DialogTitle>
          <DialogDescription>
            {t("bulkConsumption.swapDescription", {
              member: entry.memberName,
              qty: entry.qty,
              item: entry.itemName,
              date: entry.date,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`swap-${entry.id}`}>{t("bulkConsumption.swapTo")}</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id={`swap-${entry.id}`} className="w-full">
              <SelectValue placeholder={t("purchases.selectItem")} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                  <span className="text-xs text-muted-foreground">
                    {t("items.stockLabel", { qty: item.stockQty })}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSwap} disabled={isPending || !targetId}>
            {isPending ? t("common.processing") : t("bulkConsumption.swapConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
