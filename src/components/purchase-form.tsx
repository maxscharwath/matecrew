"use client";

import { useTransition, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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

interface PurchaseFormProps {
  readonly officeId: string;
  readonly members: Member[];
}

export function PurchaseForm({ officeId, members }: PurchaseFormProps) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [qty, setQty] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);
  const t = useTranslations();

  const perCan = qty > 0 ? totalPrice / qty : 0;

  function resetForm() {
    formRef.current?.reset();
    setQty(0);
    setTotalPrice(0);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createPurchaseBatch(officeId, formData);
      if (result.success) {
        toast.success(t('purchases.purchaseRecorded'));
        resetForm();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('purchases.newPurchase')}</CardTitle>
        <CardDescription>
          {t('purchases.newPurchaseDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchasedAt">{t('purchases.date')}</Label>
              <Input
                id="purchasedAt"
                name="purchasedAt"
                type="date"
                required
                defaultValue={new Date().toISOString().split("T")[0]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty">{t('purchases.qtyCans')}</Label>
              <Input
                id="qty"
                name="qty"
                type="number"
                min={1}
                required
                placeholder="24"
                onChange={(e) => setQty(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totalPrice">{t('purchases.totalPaidChf')}</Label>
              <Input
                id="totalPrice"
                name="totalPrice"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="52.50"
                onChange={(e) => setTotalPrice(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          {qty > 0 && totalPrice > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('purchases.perCan', { price: perCan.toFixed(2) })}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paidByUserId">{t('purchases.paidBy')}</Label>
              <Select name="paidByUserId" required>
                <SelectTrigger>
                  <SelectValue placeholder={t('purchases.selectMember')} />
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
            <div className="space-y-2">
              <Label htmlFor="invoices">{t('purchases.invoice')}</Label>
              <Input
                id="invoices"
                name="invoices"
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">{t('purchases.notes')}</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder={t('purchases.notesPlaceholder')}
              rows={2}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? t('purchases.recording') : t('purchases.recordPurchase')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
