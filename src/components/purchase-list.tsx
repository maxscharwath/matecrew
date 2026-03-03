"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Download, PackageCheck } from "lucide-react";
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
  notes: string | null;
  invoices: Invoice[];
}

interface PurchaseListProps {
  readonly officeId: string;
  readonly batches: PurchaseBatch[];
}

export function PurchaseList({ officeId, batches }: PurchaseListProps) {
  const [isPending, startTransition] = useTransition();

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
        toast.success("Delivery received — stock updated");
      } else {
        toast.error(result.error);
      }
    });
  }

  if (batches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No purchases recorded yet.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-center">Qty</TableHead>
            <TableHead className="text-right">Per Can</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Paid By</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead>Actions</TableHead>
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
                  {batch.status === "DELIVERED" ? "Delivered" : "Ordered"}
                </Badge>
              </TableCell>
              <TableCell>
                {new Date(batch.purchasedAt).toLocaleDateString("fr-CH")}
              </TableCell>
              <TableCell className="text-center">{batch.qty}</TableCell>
              <TableCell className="text-right">
                {batch.unitPrice.toFixed(2)}
              </TableCell>
              <TableCell className="text-right font-medium">
                CHF {batch.totalPrice.toFixed(2)}
              </TableCell>
              <TableCell>{batch.paidByName}</TableCell>
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
                      title="Mark as delivered"
                    >
                      <PackageCheck className="mr-1 h-3 w-3" />
                      Received
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
