"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Check } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markPaymentPaid } from "@/app/org/[officeId]/reimbursements/actions";

export interface PaymentLine {
  lineId: string;
  direction: "pay" | "receive";
  otherUserName: string;
  otherUserImage?: string;
  amount: number;
  status: string;
}

interface PaymentLineRowProps {
  readonly officeId: string;
  readonly line: PaymentLine;
  /// Shown under the name. Set it in the cross-period panel, where a row on its
  /// own gives no clue which month it settles; omit it inside a period card.
  readonly periodLabel?: string;
  /// Drops the action button for a plain status badge. Period cards use this so
  /// the same payment does not offer two competing buttons on one screen — the
  /// pending-payments panel at the top of the page is where you act.
  readonly readOnly?: boolean;
}

/// One person-to-person payment. The counterparty is the headline — who to pay
/// is the thing people come to this page for — with the direction carried by
/// the wording, the arrow and the colour of the amount all at once.
export function PaymentLineRow({
  officeId,
  line,
  periodLabel,
  readOnly = false,
}: PaymentLineRowProps) {
  const t = useTranslations("reimbursements");
  const [isPending, startTransition] = useTransition();

  const isPay = line.direction === "pay";
  const isPaid = line.status === "PAID";
  const DirectionIcon = isPay ? ArrowUpRight : ArrowDownLeft;

  function handleMarkPaid() {
    startTransition(async () => {
      const result = await markPaymentPaid(officeId, line.lineId);
      if (result.success) {
        toast.success(t("paymentMarkedPaid"));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-l-4 bg-card p-3",
        isPay
          ? "border-l-red-500 dark:border-l-red-600"
          : "border-l-emerald-500 dark:border-l-emerald-600",
        isPaid && "opacity-60",
      )}
    >
      <Avatar size="lg">
        <AvatarImage src={line.otherUserImage} alt={line.otherUserName} />
        <AvatarFallback>
          {line.otherUserName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm">
          {isPay ? (
            <>
              <span className="text-muted-foreground">{t("payTo")} </span>
              <span className="font-semibold">{line.otherUserName}</span>
            </>
          ) : (
            <>
              <span className="font-semibold">{line.otherUserName}</span>
              <span className="text-muted-foreground"> {t("owesYou")}</span>
            </>
          )}
        </p>
        {periodLabel && (
          <p className="truncate text-xs text-muted-foreground">{periodLabel}</p>
        )}
      </div>

      <p
        className={cn(
          "flex items-center gap-1 text-base font-semibold tabular-nums",
          isPaid
            ? "text-muted-foreground"
            : isPay
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        <DirectionIcon className="size-4 shrink-0" />
        CHF {line.amount.toFixed(2)}
      </p>

      {isPaid ? (
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" />
          {t("paidLabel")}
        </span>
      ) : readOnly ? (
        <Badge variant="outline" className="whitespace-nowrap">
          {t("pendingLabel")}
        </Badge>
      ) : (
        <Button
          size="sm"
          variant={isPay ? "default" : "outline"}
          disabled={isPending}
          onClick={handleMarkPaid}
        >
          <Check className="size-4" />
          {isPay ? t("markAsPaid") : t("confirmReceived")}
        </Button>
      )}
    </div>
  );
}
