"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Download, Lock, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  closePeriod,
  recalculatePeriod,
  deletePeriod,
  exportPeriodCsv,
} from "@/app/org/[officeId]/admin/reimbursements/actions";

interface Line {
  id: string;
  fromUserName: string;
  toUserName: string;
  amount: number;
}

interface Share {
  userName: string;
  qty: number;
  costShare: number;
  amountPaid: number;
  netOwed: number;
}

interface ReimbursementPeriodCardProps {
  readonly officeId: string;
  readonly period: {
    id: string;
    startDate: string;
    endDate: string;
    closedAt: string | null;
    lines: Line[];
  };
  readonly shares: Share[];
  readonly totalConsumption: number;
  readonly totalCost: number;
}

export function ReimbursementPeriodCard({
  officeId,
  period,
  shares,
  totalConsumption,
  totalCost,
}: ReimbursementPeriodCardProps) {
  const [isPending, startTransition] = useTransition();
  const isOpen = !period.closedAt;

  function handleClose() {
    startTransition(async () => {
      const result = await closePeriod(officeId, period.id);
      if (result.success) {
        toast.success("Period closed");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRecalculate() {
    startTransition(async () => {
      const result = await recalculatePeriod(officeId, period.id);
      if (result.success) {
        toast.success("Period recalculated");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deletePeriod(officeId, period.id);
      if (result.success) {
        toast.success("Period deleted");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleExport() {
    startTransition(async () => {
      const result = await exportPeriodCsv(officeId, period.id);
      if (result.success) {
        const blob = new Blob([result.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `reimbursement-${period.startDate}-${period.endDate}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        toast.error(result.error);
      }
    });
  }

  const start = new Date(period.startDate).toLocaleDateString("fr-CH");
  const end = new Date(period.endDate).toLocaleDateString("fr-CH");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">
              {start} — {end}
            </CardTitle>
            <CardDescription>
              {totalConsumption} matés consumed · CHF {totalCost.toFixed(2)}{" "}
              total cost
            </CardDescription>
          </div>
          <Badge variant={isOpen ? "secondary" : "default"}>
            {isOpen ? "Open" : "Closed"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {shares.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-center">Consumed</TableHead>
                  <TableHead className="text-right">Cost Share</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shares.map((s) => (
                  <TableRow key={s.userName}>
                    <TableCell className="font-medium">{s.userName}</TableCell>
                    <TableCell className="text-center">{s.qty}</TableCell>
                    <TableCell className="text-right">
                      {s.costShare.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.amountPaid.toFixed(2)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        s.netOwed > 0
                          ? "text-red-600 dark:text-red-400"
                          : s.netOwed < 0
                            ? "text-green-600 dark:text-green-400"
                            : ""
                      }`}
                    >
                      {s.netOwed > 0
                        ? `+${s.netOwed.toFixed(2)}`
                        : s.netOwed.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {period.lines.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium">Payment Lines</h4>
            <div className="space-y-1">
              {period.lines.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    {l.fromUserName} → {l.toUserName}
                  </span>
                  <span className="font-medium">
                    CHF {l.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={handleExport}
          >
            <Download className="mr-1 h-4 w-4" />
            Export CSV
          </Button>
          {isOpen && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleRecalculate}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Recalculate
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleClose}
              >
                <Lock className="mr-1 h-4 w-4" />
                Close Period
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={handleDelete}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
