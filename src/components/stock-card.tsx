"use client";

import { useTransition, useRef } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { adjustStock } from "@/app/org/[officeId]/admin/stock/actions";

interface StockCardProps {
  officeId: string;
  officeName: string;
  currentQty: number;
  lowStockThreshold: number;
}

export function StockCard({
  officeId,
  officeName,
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{officeName}</CardTitle>
          <CardDescription>{t('stock.currentStockLevel')}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold">{currentQty}</span>
          {isLow && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('stock.low')}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleAdjust} className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="w-24">
              <Input
                name="adjustment"
                type="number"
                placeholder={t('stock.adjustPlaceholder')}
                required
              />
            </div>
            <div className="flex-1">
              <Input
                name="note"
                placeholder={t('stock.reasonPlaceholder')}
              />
            </div>
            <Button type="submit" variant="outline" disabled={isPending}>
              {isPending ? t('stock.adjusting') : t('stock.adjust')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
