"use client";

import { useTransition, useRef } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AlertTriangle, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { adjustStock } from "@/app/org/[officeId]/admin/stock/actions";

interface StockCardProps {
  officeId: string;
  itemId: string;
  itemName: string;
  currentQty: number;
  lowStockThreshold: number;
}

export function StockCard({
  officeId,
  itemId,
  itemName,
  currentQty,
  lowStockThreshold,
}: StockCardProps) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations();
  const isLow = currentQty <= lowStockThreshold;

  function handleAdjust(formData: FormData) {
    startTransition(async () => {
      const result = await adjustStock(officeId, formData);
      if (result.success) {
        toast.success(t('stock.stockUpdated'));
        formRef.current?.reset();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card className={cn(isLow && "border-destructive/40")}>
      <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center">
        {/* Identity + level */}
        <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              isLow
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Boxes className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium leading-tight">{itemName}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className={cn(
                  "text-2xl font-bold leading-none tabular-nums",
                  isLow && "text-destructive",
                )}
              >
                {currentQty}
              </span>
              {isLow && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="size-3" />
                  {t('stock.low')}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Adjust form */}
        <form
          ref={formRef}
          action={handleAdjust}
          className="flex flex-1 items-end gap-2"
        >
          <input type="hidden" name="itemId" value={itemId} />
          <div className="w-24 shrink-0">
            <Input
              name="adjustment"
              type="number"
              placeholder={t('stock.adjustPlaceholder')}
              className="text-right tabular-nums"
              required
            />
          </div>
          <div className="flex-1">
            <Input name="note" placeholder={t('stock.reasonPlaceholder')} />
          </div>
          <Button type="submit" variant="outline" disabled={isPending}>
            {isPending ? t('stock.adjusting') : t('stock.adjust')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
