"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations, useLocale } from "next-intl";
import { Download, PackageCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getInvoiceUrl,
  markDelivered,
} from "@/app/org/[officeId]/admin/purchases/actions";

interface Invoice {
  id: string;
  filename: string;
}

interface PurchaseBatch {
  id: string;
  status: "ORDERED" | "DELIVERED";
  purchasedAt: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  paidByName: string;
  paidByImage?: string;
  notes: string | null;
  invoices: Invoice[];
}

interface PurchaseListProps {
  readonly officeId: string;
  readonly batches: PurchaseBatch[];
}

export function PurchaseList({ officeId, batches }: PurchaseListProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();
  const locale = useLocale();

  function handleDownload(invoiceId: string) {
    startTransition(async () => {
      const result = await getInvoiceUrl(officeId, invoiceId);
      if (result.success) {
        window.open(result.url, "_blank");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleMarkDelivered(batchId: string) {
    startTransition(async () => {
      const result = await markDelivered(officeId, batchId);
      if (result.success) {
        toast.success(t('purchases.deliveryReceived'));
      } else {
        toast.error(result.error);
      }
    });
  }

  if (batches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('purchases.noPurchases')}
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('purchases.status')}</TableHead>
            <TableHead>{t('purchases.date')}</TableHead>
            <TableHead className="text-center">{t('purchases.qty')}</TableHead>
            <TableHead className="text-right">{t('purchases.perCanHeader')}</TableHead>
            <TableHead className="text-right">{t('purchases.total')}</TableHead>
            <TableHead>{t('purchases.paidBy')}</TableHead>
            <TableHead>{t('purchases.notes')}</TableHead>
            <TableHead>{t('purchases.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <TableRow key={batch.id}>
              <TableCell>
                <Badge
                  variant={
                    batch.status === "DELIVERED" ? "default" : "secondary"
                  }
                >
                  {batch.status === "DELIVERED" ? t('purchases.delivered') : t('purchases.ordered')}
                </Badge>
              </TableCell>
              <TableCell>
                {new Date(batch.purchasedAt).toLocaleDateString(locale)}
              </TableCell>
              <TableCell className="text-center">{batch.qty}</TableCell>
              <TableCell className="text-right">
                {batch.unitPrice.toFixed(2)}
              </TableCell>
              <TableCell className="text-right font-medium">
                CHF {batch.totalPrice.toFixed(2)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar size="sm">
                    <AvatarImage src={batch.paidByImage} alt={batch.paidByName} />
                    <AvatarFallback>{batch.paidByName.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  {batch.paidByName}
                </div>
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-muted-foreground">
                {batch.notes ?? "—"}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {batch.status === "ORDERED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleMarkDelivered(batch.id)}
                    >
                      <PackageCheck className="mr-1 h-3 w-3" />
                      {t('purchases.received')}
                    </Button>
                  )}
                  {batch.invoices.map((inv) => (
                    <Button
                      key={inv.id}
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleDownload(inv.id)}
                      title={inv.filename}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
