"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, ChevronDown, ChevronUp, MailWarning } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { sendPaymentReminder } from "./actions";

/** One month this person has not settled, and who it is owed to. */
interface DebtorPeriod {
  periodId: string;
  label: string;
  amount: number;
  currency: string;
  creditors: { name: string; amount: number }[];
}

export interface DebtorRow {
  userId: string;
  name: string;
  email: string | null;
  image?: string;
  totals: { currency: string; amount: number }[];
  periods: DebtorPeriod[];
}

interface Props {
  readonly officeId: string;
  readonly debtors: DebtorRow[];
}

function money(amount: number, currency: string) {
  return `${currency} ${amount.toFixed(2)}`;
}

/**
 * Who still owes the office money, and the button that tells them so.
 *
 * Sits above the period list because it answers the question an admin
 * actually opens this page with — "who has not paid?" — which the periods
 * only answer one month at a time. Expanding a row breaks the total back down
 * into the months it came from, so the number is never something the admin
 * has to take on trust.
 */
export function OutstandingBalancesCard({ officeId, debtors }: Props) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [remindAllOpen, setRemindAllOpen] = useState(false);
  const [remindOne, setRemindOne] = useState<DebtorRow | null>(null);
  const t = useTranslations();

  function handleRemind(userId?: string) {
    startTransition(async () => {
      const result = await sendPaymentReminder(officeId, userId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const notes = [
        result.skipped > 0
          ? t("reimbursements.remindSkipped", { count: result.skipped })
          : null,
        result.failed > 0
          ? t("reimbursements.remindFailed", { count: result.failed })
          : null,
      ].filter(Boolean);
      toast.success(t("reimbursements.remindSent", { count: result.sent }), {
        description: notes.length > 0 ? notes.join(" · ") : undefined,
      });
      setRemindAllOpen(false);
      setRemindOne(null);
    });
  }

  const reachable = debtors.filter((d) => d.email);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{t("reimbursements.outstandingTitle")}</CardTitle>
              <CardDescription className="mt-1">
                {t("reimbursements.outstandingSubtitle")}
              </CardDescription>
            </div>
            {reachable.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => setRemindAllOpen(true)}
              >
                <BellRing className="mr-1.5 size-4" />
                {isPending
                  ? t("reimbursements.reminding")
                  : t("reimbursements.remindAll")}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {debtors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("reimbursements.outstandingEmpty")}
            </p>
          ) : (
            <div className="space-y-2">
              {debtors.map((debtor) => {
                const isOpen = expanded === debtor.userId;
                return (
                  <div
                    key={debtor.userId}
                    className="rounded-lg border"
                  >
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        onClick={() =>
                          setExpanded(isOpen ? null : debtor.userId)
                        }
                      >
                        <Avatar size="sm">
                          <AvatarImage src={debtor.image} alt={debtor.name} />
                          <AvatarFallback>
                            {debtor.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm font-medium">
                          {debtor.name}
                        </span>
                        <Badge
                          variant="secondary"
                          className="px-1.5 py-0 text-[10px]"
                        >
                          {t("reimbursements.remindUnpaidPeriods", {
                            count: debtor.periods.length,
                          })}
                        </Badge>
                        {!debtor.email && (
                          <span
                            className="flex items-center gap-1 text-xs text-muted-foreground"
                            title={t("reimbursements.remindNoEmail")}
                          >
                            <MailWarning className="size-3.5" />
                          </span>
                        )}
                        {isOpen ? (
                          <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          {debtor.totals.map((total) => (
                            <span
                              key={total.currency}
                              className="block text-sm font-semibold tabular-nums text-red-600 dark:text-red-400"
                            >
                              {money(total.amount, total.currency)}
                            </span>
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isPending || !debtor.email}
                          title={
                            debtor.email
                              ? undefined
                              : t("reimbursements.remindNoEmail")
                          }
                          onClick={() => setRemindOne(debtor)}
                        >
                          <BellRing className="mr-1 size-3" />
                          {t("reimbursements.remind")}
                        </Button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="space-y-1.5 border-t px-4 py-3">
                        {debtor.periods.map((period) => (
                          <div
                            key={`${period.periodId}-${period.currency}`}
                            className="flex items-baseline justify-between gap-3 text-sm"
                          >
                            <div className="min-w-0">
                              <span className="capitalize">{period.label}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {period.creditors
                                  .map(
                                    (c) =>
                                      `${c.name} · ${money(c.amount, period.currency)}`,
                                  )
                                  .join(" — ")}
                              </span>
                            </div>
                            <span className="shrink-0 tabular-nums">
                              {money(period.amount, period.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={remindAllOpen}
        onOpenChange={setRemindAllOpen}
        onConfirm={() => handleRemind()}
        title={t("reimbursements.remindConfirmAllTitle")}
        description={t("reimbursements.remindConfirmAllDescription", {
          count: reachable.length,
        })}
        confirmLabel={t("reimbursements.remindAll")}
        confirmVariant="default"
        isPending={isPending}
      />

      <ConfirmDialog
        open={remindOne !== null}
        onOpenChange={(open) => !open && setRemindOne(null)}
        onConfirm={() => remindOne && handleRemind(remindOne.userId)}
        title={t("reimbursements.remindConfirmOneTitle", {
          name: remindOne?.name ?? "",
        })}
        description={t("reimbursements.remindConfirmOneDescription", {
          count: remindOne?.periods.length ?? 0,
        })}
        confirmLabel={t("reimbursements.remind")}
        confirmVariant="default"
        isPending={isPending}
      />
    </>
  );
}
