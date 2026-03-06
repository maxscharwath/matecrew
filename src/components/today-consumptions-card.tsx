"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Undo2, CupSoda } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cancelConsumption } from "@/app/org/[officeId]/dashboard/actions";

interface ConsumptionItem {
  id: string;
  source: "DAILY_REQUEST" | "MANUAL";
  qty: number;
  cancelledAt: string | null;
  createdAt: string;
}

interface TodayConsumptionsCardProps {
  readonly officeId: string;
  readonly consumptions: ConsumptionItem[];
}

export function TodayConsumptionsCard({
  officeId,
  consumptions,
}: TodayConsumptionsCardProps) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  if (consumptions.length === 0) return null;

  const activeCount = consumptions.filter((c) => !c.cancelledAt).length;

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
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CupSoda className="size-4 text-amber-500" />
              <CardTitle className="text-base">{t("dashboard.todayConsumptions")}</CardTitle>
            </div>
            <Badge variant="secondary">{activeCount}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {consumptions.map((c) => (
              <div
                key={c.id}
                className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                  c.cancelledAt ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleTimeString([], {
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
            ))}
          </div>
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
