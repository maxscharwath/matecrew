"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  markServed,
  markCancelled,
} from "@/app/org/[officeId]/runner/actions";
import { formatDateDisplay } from "@/lib/date";

export interface ForgottenOrder {
  id: string;
  date: Date | string;
  user: { id: string; name: string; email: string; image: string | undefined };
  session: {
    id: string;
    label: string | null;
    startTime: string;
    cutoffTime: string;
  } | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ForgottenOrdersSection({
  officeId,
  orders,
}: {
  readonly officeId: string;
  readonly orders: ForgottenOrder[];
}) {
  const t = useTranslations("runner");
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = orders.filter((o) => !resolved.has(o.id));
  if (visible.length === 0) return null;

  function resolve(id: string, action: "serve" | "cancel") {
    setPendingId(id);
    startTransition(async () => {
      const result =
        action === "serve"
          ? await markServed(officeId, id)
          : await markCancelled(officeId, id);
      setPendingId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setResolved((prev) => new Set(prev).add(id));
      toast.success(
        action === "serve" ? t("forgottenServedToast") : t("forgottenCancelledToast"),
      );
    });
  }

  return (
    <Card className="border-amber-300 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="space-y-3 pt-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          <span className="flex-1 text-sm font-medium">
            {t("forgottenTitle", { count: visible.length })}
          </span>
          <span className="text-xs text-muted-foreground">
            {open ? t("hide") : t("show")}
          </span>
        </button>

        {open && (
          <div className="divide-y border-t border-amber-200 dark:border-amber-900/50">
            {visible.map((order) => {
              const date =
                order.date instanceof Date ? order.date : new Date(order.date);
              const sessionLabel = order.session
                ? `${order.session.label ?? order.session.startTime}`
                : t("session");
              const isPending = pendingId === order.id;

              return (
                <div
                  key={order.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <Avatar size="sm">
                    <AvatarImage src={order.user.image} alt={order.user.name} />
                    <AvatarFallback>{getInitials(order.user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{order.user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatDateDisplay(date)} · {sessionLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => resolve(order.id, "serve")}
                    >
                      <Check className="mr-1 size-3.5" />
                      {t("forgottenServe")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => resolve(order.id, "cancel")}
                    >
                      <X className="mr-1 size-3.5" />
                      {t("forgottenCancel")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
