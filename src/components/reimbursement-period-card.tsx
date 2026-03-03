"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CupSoda,
  Download,
  FileText,
  Trash2,
  Banknote,
  ArrowRightLeft,
  Check,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  deletePeriod,
  exportPeriodCsv,
  exportPeriodPdf,
} from "@/app/org/[officeId]/admin/reimbursements/actions";
import {
  markPaymentPaid,
  markPaymentUnpaid,
} from "@/app/org/[officeId]/reimbursements/actions";

interface Line {
  id: string;
  fromUserName: string;
  toUserName: string;
  amount: number;
  status: string;
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
    lines: Line[];
  };
  readonly shares: Share[];
  readonly totalConsumption: number;
  readonly totalCost: number;
  readonly defaultExpanded?: boolean;
}

function getInitial(name: string) {
  return name.charAt(0).toUpperCase();
}

function formatPeriodLabel(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const isFullMonth =
    start.getDate() === 1 &&
    end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() &&
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear();

  if (isFullMonth) {
    return start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  return `${start.toLocaleDateString("fr-CH")} – ${end.toLocaleDateString("fr-CH")}`;
}

export function ReimbursementPeriodCard({
  officeId,
  period,
  shares,
  totalConsumption,
  totalCost,
  defaultExpanded = false,
}: ReimbursementPeriodCardProps) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const t = useTranslations();

  const paidCount = period.lines.filter((l) => l.status === "PAID").length;
  const totalLines = period.lines.length;
  const progressPct = totalLines > 0 ? (paidCount / totalLines) * 100 : 0;

  function handleDelete() {
    startTransition(async () => {
      const result = await deletePeriod(officeId, period.id);
      if (result.success) {
        toast.success(t('reimbursements.periodDeleted'));
        setDeleteOpen(false);
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

  function handleExportPdf() {
    startTransition(async () => {
      const result = await exportPeriodPdf(officeId, period.id);
      if (result.success) {
        const a = document.createElement("a");
        a.href = result.url;
        a.download = `settlement-${period.startDate.slice(0, 7)}.pdf`;
        a.click();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleMarkPaid(lineId: string) {
    startTransition(async () => {
      const result = await markPaymentPaid(officeId, lineId);
      if (result.success) {
        toast.success(t('reimbursements.paymentMarkedPaid'));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleMarkUnpaid(lineId: string) {
    startTransition(async () => {
      const result = await markPaymentUnpaid(officeId, lineId);
      if (result.success) {
        toast.success(t('reimbursements.paymentMarkedPending'));
      } else {
        toast.error(result.error);
      }
    });
  }

  const label = formatPeriodLabel(period.startDate, period.endDate);

  const totalQty = shares.reduce((s, r) => s + r.qty, 0);
  const totalCostShare = shares.reduce((s, r) => s + r.costShare, 0);
  const totalPaid = shares.reduce((s, r) => s + r.amountPaid, 0);

  return (
    <>
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold">{label}</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
                <span className="flex items-center gap-1">
                  <CupSoda className="size-3.5" />
                  {totalConsumption}
                </span>
                <span className="flex items-center gap-1">
                  <Banknote className="size-3.5" />
                  CHF {totalCost.toFixed(2)}
                </span>
                <span className="flex items-center gap-1">
                  <ArrowRightLeft className="size-3.5" />
                  {totalLines}
                </span>
                {totalLines > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-xs">
                      {paidCount}/{totalLines}
                    </span>
                  </div>
                )}
              </div>
              {expanded ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="space-y-4 pt-0">
            <Separator />

            {/* Shares table */}
            {shares.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('reimbursements.user')}</TableHead>
                      <TableHead className="text-center">{t('reimbursements.consumed')}</TableHead>
                      <TableHead className="text-right">{t('reimbursements.costShare')}</TableHead>
                      <TableHead className="text-right">{t('reimbursements.paidColumn')}</TableHead>
                      <TableHead className="text-right">{t('reimbursements.balance')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shares.map((s) => (
                      <TableRow
                        key={s.userName}
                        className={
                          s.netOwed > 0.01
                            ? "bg-red-50/50 dark:bg-red-950/10"
                            : s.netOwed < -0.01
                              ? "bg-green-50/50 dark:bg-green-950/10"
                              : ""
                        }
                      >
                        <TableCell className="font-medium">
                          {s.userName}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {s.qty}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.costShare.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.amountPaid.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`tabular-nums ${
                                s.netOwed > 0.01
                                  ? "font-medium text-red-600 dark:text-red-400"
                                  : s.netOwed < -0.01
                                    ? "font-medium text-green-600 dark:text-green-400"
                                    : "text-muted-foreground"
                              }`}
                            >
                              CHF {Math.abs(s.netOwed).toFixed(2)}
                            </span>
                            <Badge
                              variant={
                                s.netOwed > 0.01
                                  ? "destructive"
                                  : s.netOwed < -0.01
                                    ? "default"
                                    : "secondary"
                              }
                              className="text-[10px] px-1.5 py-0"
                            >
                              {s.netOwed > 0.01
                                ? t('common.owes')
                                : s.netOwed < -0.01
                                  ? t('common.owed')
                                  : t('common.settled')}
                            </Badge>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-medium">{t('reimbursements.totalRow')}</TableCell>
                      <TableCell className="text-center tabular-nums font-medium">
                        {totalQty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {totalCostShare.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {totalPaid.toFixed(2)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}

            {/* Payment lines */}
            {period.lines.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium">{t('reimbursements.payments')}</h4>
                <div className="space-y-2">
                  {period.lines.map((l) => (
                    <div
                      key={l.id}
                      className={`flex items-center justify-between rounded-lg border px-4 py-3 border-l-2 ${
                        l.status === "PAID"
                          ? "border-l-green-400 opacity-60 dark:border-l-green-600"
                          : "border-l-amber-400 dark:border-l-amber-600"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-7 items-center justify-center rounded-full bg-red-100 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          {getInitial(l.fromUserName)}
                        </span>
                        <span className="text-sm font-medium">
                          {l.fromUserName}
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {l.toUserName}
                        </span>
                        <span className="flex size-7 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          {getInitial(l.toUserName)}
                        </span>
                        <Badge
                          variant={l.status === "PAID" ? "default" : "secondary"}
                          className="ml-1 text-[10px] px-1.5 py-0"
                        >
                          {l.status === "PAID" ? t('common.paid') : t('common.pending')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">
                          CHF {l.amount.toFixed(2)}
                        </span>
                        {l.status === "PENDING" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkPaid(l.id);
                            }}
                          >
                            <Check className="mr-1 size-3" />
                            {t('reimbursements.markPaid')}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkUnpaid(l.id);
                            }}
                          >
                            <Undo2 className="mr-1 size-3" />
                            {t('reimbursements.undo')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={handleExport}
                >
                  <Download className="mr-1 size-4" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={handleExportPdf}
                >
                  <FileText className="mr-1 size-4" />
                  PDF
                </Button>
              </div>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1 size-4" />
                {t('common.delete')}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t('reimbursements.deleteThisPeriod')}
        description={t('reimbursements.deleteDescription')}
        confirmLabel={t('reimbursements.deletePeriod')}
        confirmVariant="destructive"
        isPending={isPending}
      />
    </>
  );
}
