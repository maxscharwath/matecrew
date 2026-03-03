"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CupSoda,
  Banknote,
  Check,
  FileText,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  markPaymentPaid,
  exportUserPeriodPdf,
} from "@/app/org/[officeId]/reimbursements/actions";

interface UserPaymentLine {
  lineId: string;
  direction: "pay" | "receive";
  otherUserName: string;
  otherUserImage?: string;
  amount: number;
  status: string;
}

interface UserReimbursementCardProps {
  readonly officeId: string;
  readonly periodId: string;
  readonly label: string;
  readonly qty: number;
  readonly costShare: number;
  readonly amountPaid: number;
  readonly netOwed: number;
  readonly lines: UserPaymentLine[];
  readonly defaultExpanded?: boolean;
}

function getInitial(name: string) {
  return name.charAt(0).toUpperCase();
}

export function UserReimbursementCard({
  officeId,
  periodId,
  label,
  qty,
  costShare,
  amountPaid,
  netOwed,
  lines,
  defaultExpanded = false,
}: UserReimbursementCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  const pendingLines = lines.filter((l) => l.status === "PENDING");
  const paidCount = lines.filter((l) => l.status === "PAID").length;
  const pendingOwed = pendingLines
    .filter((l) => l.direction === "pay")
    .reduce((sum, l) => sum + l.amount, 0);
  const pendingOwedToYou = pendingLines
    .filter((l) => l.direction === "receive")
    .reduce((sum, l) => sum + l.amount, 0);

  const balanceText =
    pendingOwed > 0.01
      ? t('reimbursements.youOweCHF', { amount: pendingOwed.toFixed(2) })
      : pendingOwedToYou > 0.01
        ? t('reimbursements.youAreOwedCHF', { amount: pendingOwedToYou.toFixed(2) })
        : t('reimbursements.settledLabel');

  const balanceColor =
    pendingOwed > 0.01
      ? "text-red-600 dark:text-red-400"
      : pendingOwedToYou > 0.01
        ? "text-green-600 dark:text-green-400"
        : "text-muted-foreground";

  const dotColor =
    pendingOwed > 0.01
      ? "bg-red-500"
      : pendingOwedToYou > 0.01
        ? "bg-green-500"
        : "bg-muted-foreground";

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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold">{label}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 sm:flex">
              <span className={`size-2 rounded-full ${dotColor}`} />
              <span className={`text-sm font-medium ${balanceColor}`}>
                {balanceText}
              </span>
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

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CupSoda className="size-3 text-amber-500" />
                {t('reimbursements.consumed')}
              </p>
              <p className="mt-1 text-base font-semibold">{qty}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Banknote className="size-3 text-blue-500" />
                {t('reimbursements.yourShare')}
              </p>
              <p className="mt-1 text-base font-semibold">
                CHF {costShare.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t('reimbursements.youPaid')}</p>
              <p className="mt-1 text-base font-semibold">
                CHF {amountPaid.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t('reimbursements.balance')}</p>
              <p className={`mt-1 text-base font-semibold ${balanceColor}`}>
                {balanceText}
              </p>
            </div>
          </div>

          {/* Payment lines */}
          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((l) => (
                <div
                  key={l.lineId}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 border-l-2 ${
                    l.direction === "pay"
                      ? "border-l-red-300 dark:border-l-red-700"
                      : "border-l-green-300 dark:border-l-green-700"
                  } ${l.status === "PAID" ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-2.5">
                    {l.direction === "pay" ? (
                      <>
                        <span className="text-sm text-muted-foreground">
                          {t('reimbursements.youPayLabel')}
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground" />
                        <Avatar size="sm">
                          <AvatarImage src={l.otherUserImage} alt={l.otherUserName} />
                          <AvatarFallback>{getInitial(l.otherUserName)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">
                          {l.otherUserName}
                        </span>
                      </>
                    ) : (
                      <>
                        <Avatar size="sm">
                          <AvatarImage src={l.otherUserImage} alt={l.otherUserName} />
                          <AvatarFallback>{getInitial(l.otherUserName)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">
                          {l.otherUserName}
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {t('reimbursements.paysYouLabel')}
                        </span>
                      </>
                    )}
                    <Badge
                      variant={l.status === "PAID" ? "default" : "secondary"}
                      className="ml-1 text-[10px] px-1.5 py-0"
                    >
                      {l.status === "PAID" ? t('common.paid') : t('common.pending')}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      CHF {l.amount.toFixed(2)}
                    </span>
                    {l.status === "PENDING" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkPaid(l.lineId);
                        }}
                      >
                        <Check className="mr-1 size-3" />
                        {l.direction === "pay"
                          ? t('reimbursements.markAsPaid')
                          : t('reimbursements.confirmReceived')}
                      </Button>
                    )}
                    {l.status === "PAID" && (
                      <Check className="size-4 text-green-600 dark:text-green-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {t('reimbursements.paymentsCompleted', { paid: paidCount, total: lines.length })}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleExportPdf}
            >
              <FileText className="mr-1.5 size-4" />
              {t('reimbursements.exportPdf')}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
