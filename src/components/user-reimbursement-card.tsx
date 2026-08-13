"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  CupSoda,
  Banknote,
  Check,
  FileText,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PaymentLineRow, type PaymentLine } from "@/components/payment-line-row";
import { exportUserPeriodPdf } from "@/app/org/[officeId]/reimbursements/actions";

interface UserReimbursementCardProps {
  readonly officeId: string;
  readonly periodId: string;
  readonly label: string;
  readonly qty: number;
  readonly costShare: number;
  /** Part of `costShare` that is this person's share of the missing cans. */
  readonly lossShare: number;
  readonly amountPaid: number;
  readonly lines: PaymentLine[];
  readonly defaultExpanded?: boolean;
}

export function UserReimbursementCard({
  officeId,
  periodId,
  label,
  qty,
  costShare,
  lossShare,
  amountPaid,
  lines,
  defaultExpanded = false,
}: UserReimbursementCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  const pendingLines = lines.filter((l) => l.status === "PENDING");
  const paidCount = lines.length - pendingLines.length;
  const pendingOwed = pendingLines
    .filter((l) => l.direction === "pay")
    .reduce((sum, l) => sum + l.amount, 0);
  const pendingOwedToYou = pendingLines
    .filter((l) => l.direction === "receive")
    .reduce((sum, l) => sum + l.amount, 0);

  const owes = pendingOwed > 0.01;
  const isOwed = pendingOwedToYou > 0.01;

  // The header carries the outcome on its own, so the body no longer repeats
  // it as a fourth "Balance" tile.
  const statusText = owes
    ? t("reimbursements.youOweCHF", { amount: pendingOwed.toFixed(2) })
    : isOwed
      ? t("reimbursements.youAreOwedCHF", {
          amount: pendingOwedToYou.toFixed(2),
        })
      : t("reimbursements.settledLabel");

  function handleExportPdf() {
    startTransition(async () => {
      const result = await exportUserPeriodPdf(officeId, periodId);
      if (result.success) {
        const a = document.createElement("a");
        a.href = result.url;
        a.download = `my-settlement-${label}.pdf`;
        a.click();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="font-semibold">{label}</span>
          <div className="flex items-center gap-3">
            <Badge
              variant={
                owes ? "destructive" : isOwed ? "default" : "secondary"
              }
              className="whitespace-nowrap"
            >
              {owes || isOwed ? (
                <Wallet className="size-3" />
              ) : (
                <Check className="size-3" />
              )}
              {statusText}
            </Badge>
            {expanded ? (
              <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          <Separator />

          {/* Payments first: the accounting breakdown below only explains how
              these amounts were reached. */}
          {lines.length > 0 ? (
            <div className="space-y-2">
              {lines.map((l) => (
                <PaymentLineRow
                  key={l.lineId}
                  officeId={officeId}
                  line={l}
                  readOnly
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("reimbursements.noPaymentsThisPeriod")}
            </p>
          )}

          <div className="rounded-lg bg-muted/50 p-3">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("reimbursements.breakdown")}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2 sm:block">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CupSoda className="size-3 text-amber-500" />
                  {t("reimbursements.consumed")}
                </p>
                <p className="text-sm font-semibold tabular-nums sm:mt-1">
                  {qty}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Banknote className="size-3 text-blue-500" />
                  {t("reimbursements.yourShare")}
                </p>
                <div className="sm:mt-1">
                  <p className="text-sm font-semibold tabular-nums">
                    CHF {costShare.toFixed(2)}
                  </p>
                  {Math.abs(lossShare) > 0.005 && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t("reimbursements.ofWhichLoss", {
                        amount: lossShare.toFixed(2),
                      })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <p className="text-xs text-muted-foreground">
                  {t("reimbursements.youPaid")}
                </p>
                <p className="text-sm font-semibold tabular-nums sm:mt-1">
                  CHF {amountPaid.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("reimbursements.paymentsCompleted", {
                paid: paidCount,
                total: lines.length,
              })}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleExportPdf}
            >
              <FileText className="size-4" />
              {t("reimbursements.exportPdf")}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
