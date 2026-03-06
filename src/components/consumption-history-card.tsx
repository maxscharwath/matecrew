"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cancelConsumption } from "@/app/org/[officeId]/dashboard/actions";

interface ConsumptionItem {
  id: string;
  date: string;
  createdAt: string;
  source: "DAILY_REQUEST" | "MANUAL";
  qty: number;
  cancelledAt: string | null;
}

interface ConsumptionHistoryCardProps {
  readonly officeId: string;
  readonly consumptions: ConsumptionItem[];
  readonly locale: string;
}

export function ConsumptionHistoryCard({
  officeId,
  consumptions,
  locale,
}: ConsumptionHistoryCardProps) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  function handleConfirmCancel() {
    if (!cancelTarget) return;
    startTransition(async () => {
      const result = await cancelConsumption(officeId, cancelTarget);
      setCancelTarget(null);
      if (result.success) {
        toast.success(t("dashboard.consumptionCancelled"));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("reimbursements.consumptionHistory")}</CardTitle>
          <CardDescription>
            {t("reimbursements.consumptionHistoryDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consumptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("reimbursements.noConsumptions")}
            </p>
          ) : (
            <div className="space-y-2">
              {consumptions.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    c.cancelledAt ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {new Date(c.createdAt).toLocaleDateString(locale, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {c.source === "MANUAL"
                        ? t("dashboard.selfServe")
                        : t("dashboard.dailyRequest")}
                    </Badge>
                    {c.cancelledAt && (
                      <Badge variant="destructive" className="text-xs">
                        {t("dashboard.cancelled")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      x{c.qty}
                    </span>
                    {!c.cancelledAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setCancelTarget(c.id)}
                        disabled={isPending}
                      >
                        <Undo2 className="mr-1 h-3 w-3" />
                        {t("dashboard.cancelConsumption")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        onConfirm={handleConfirmCancel}
        title={t("dashboard.cancelConsumptionTitle")}
        description={t("dashboard.cancelConsumptionDescription")}
        confirmLabel={t("dashboard.cancelConsumption")}
        confirmVariant="destructive"
        isPending={isPending}
      />
    </>
  );
}
