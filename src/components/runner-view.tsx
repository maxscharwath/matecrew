"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  CupSoda,
  Clock,
  ChevronLeft,
  ChevronRight,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ForgottenOrdersSection, type ForgottenOrder } from "@/components/forgotten-orders-section";
import {
  markAllServed,
  markServed,
  markUnserved,
} from "@/app/org/[officeId]/runner/actions";
import { formatDateDisplay } from "@/lib/date";
import { cn } from "@/lib/utils";

interface DailyRequest {
  id: string;
  status: "REQUESTED" | "SERVED" | "CANCELLED";
  mateSessionId: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string;
  };
}

interface SessionInfo {
  id: string;
  label: string | null;
  startTime: string;
  cutoffTime: string;
  isOpen: boolean;
}

interface RunnerViewProps {
  readonly requests: DailyRequest[];
  readonly date: Date;
  readonly officeId: string;
  readonly session: SessionInfo | null;
  readonly isToday: boolean;
  readonly prevHref: string | null;
  readonly nextHref: string | null;
  readonly currentSessionHref: string | null;
  readonly stockQty: number;
  readonly lowStockThreshold: number;
  readonly forgottenOrders: ForgottenOrder[];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function SessionNavigator({
  date,
  session,
  prevHref,
  nextHref,
  currentSessionHref,
}: {
  readonly date: Date;
  readonly session: SessionInfo | null;
  readonly prevHref: string | null;
  readonly nextHref: string | null;
  readonly currentSessionHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("runner");

  const label = session
    ? `${formatDateDisplay(date)} — ${session.label ?? session.startTime}`
    : formatDateDisplay(date);

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={!prevHref}
        onClick={() => prevHref && router.push(`${pathname}${prevHref}`)}
        aria-label={t("previousSession")}
      >
        <ChevronLeft className="size-4" />
      </Button>

      <span className="min-w-40 text-center text-sm text-muted-foreground">
        {label}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={!nextHref}
        onClick={() => nextHref && router.push(`${pathname}${nextHref}`)}
        aria-label={t("nextSession")}
      >
        <ChevronRight className="size-4" />
      </Button>

      {currentSessionHref && (
        <Button
          variant="outline"
          size="sm"
          className="ml-1 h-7 text-xs"
          onClick={() => router.push(`${pathname}${currentSessionHref}`)}
        >
          {t("currentSession")}
        </Button>
      )}
    </div>
  );
}

function RequestRow({
  request,
  officeId,
  disabled,
  onToggle,
}: {
  readonly request: DailyRequest;
  readonly officeId: string;
  readonly disabled: boolean;
  readonly onToggle: (id: string, served: boolean) => void;
}) {
  const t = useTranslations("runner");
  const isServed = request.status === "SERVED";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(request.id, !isServed)}
      className={cn(
        "flex w-full items-center gap-3 rounded-md py-2.5 px-2 -mx-2 text-left transition-colors",
        "hover:bg-muted/60 active:bg-muted disabled:opacity-60 disabled:cursor-not-allowed",
        "min-h-12",
      )}
      aria-pressed={isServed}
      data-office-id={officeId}
    >
      <Avatar size="sm">
        <AvatarImage src={request.user.image} alt={request.user.name} />
        <AvatarFallback>{getInitials(request.user.name)}</AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "flex-1 text-sm",
          isServed ? "text-muted-foreground line-through" : "font-medium",
        )}
      >
        {request.user.name}
      </span>
      {isServed ? (
        <span className="flex size-7 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
          <Check className="size-4" />
        </span>
      ) : (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {t("waiting")}
        </Badge>
      )}
    </button>
  );
}

function StockBadge({
  qty,
  threshold,
}: {
  readonly qty: number;
  readonly threshold: number;
}) {
  const t = useTranslations("runner");
  const low = qty <= threshold;
  return (
    <Badge
      variant={low ? "destructive" : "secondary"}
      className="gap-1 text-[10px]"
    >
      <Package className="size-3" />
      {t("stockCount", { qty })}
    </Badge>
  );
}

export function RunnerView({
  requests,
  date,
  officeId,
  session,
  isToday,
  prevHref,
  nextHref,
  currentSessionHref,
  stockQty,
  lowStockThreshold,
  forgottenOrders,
}: RunnerViewProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState<
    Record<string, "REQUESTED" | "SERVED">
  >({});
  const t = useTranslations();

  const merged: DailyRequest[] = requests.map((r) => {
    const override = optimisticStatus[r.id];
    if (override && r.status !== "CANCELLED") {
      return { ...r, status: override };
    }
    return r;
  });

  const served = merged.filter((r) => r.status === "SERVED").length;
  const total = merged.length;
  const pendingCount = total - served;
  const pct = total === 0 ? 0 : Math.round((served / total) * 100);

  function toggleRow(id: string, markServedNow: boolean) {
    const previous =
      optimisticStatus[id] ?? requests.find((r) => r.id === id)?.status ?? "REQUESTED";
    const next: "REQUESTED" | "SERVED" = markServedNow ? "SERVED" : "REQUESTED";
    setOptimisticStatus((prev) => ({ ...prev, [id]: next }));

    startTransition(async () => {
      const result = markServedNow
        ? await markServed(officeId, id)
        : await markUnserved(officeId, id);

      if (!result.success) {
        setOptimisticStatus((prev) => ({
          ...prev,
          [id]: previous as "REQUESTED" | "SERVED",
        }));
        toast.error(result.error);
        return;
      }

      if (markServedNow) {
        toast.success(t("runner.servedToast"), {
          action: {
            label: t("runner.undo"),
            onClick: () => toggleRow(id, false),
          },
        });
      }
    });
  }

  function handleServeAll() {
    startTransition(async () => {
      const result = await markAllServed(officeId, session?.id ?? null, date);
      if (result.success) {
        toast.success(t("runner.allServedToast"));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-2xl font-bold">
            {isToday ? t("runner.title") : t("runner.titlePast")}
          </h1>
          <StockBadge qty={stockQty} threshold={lowStockThreshold} />
        </div>
        <SessionNavigator
          date={date}
          session={session}
          prevHref={prevHref}
          nextHref={nextHref}
          currentSessionHref={currentSessionHref}
        />
      </div>

      {/* Session status pill (single source of truth — no duplicate alert) */}
      {session && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          <span>
            {session.label ?? t("runner.session")} {session.startTime}–{session.cutoffTime}
          </span>
          {isToday && (
            <Badge
              variant={session.isOpen ? "default" : "secondary"}
              className="text-[10px]"
            >
              {session.isOpen ? t("runner.open") : t("runner.closed")}
            </Badge>
          )}
        </div>
      )}

      {/* Forgotten orders banner */}
      {forgottenOrders.length > 0 && (
        <ForgottenOrdersSection officeId={officeId} orders={forgottenOrders} />
      )}

      {/* Empty state */}
      {total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <CupSoda className="size-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              {isToday ? t("runner.noRequests") : t("runner.noRequestsPast")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {/* Progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("runner.progress")}</span>
                <span className="font-medium">
                  {t("runner.servedCount", { served, total })}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Tap-to-toggle list */}
            <div className="divide-y">
              {merged.map((r) => (
                <RequestRow
                  key={r.id}
                  request={r}
                  officeId={officeId}
                  disabled={isPending}
                  onToggle={toggleRow}
                />
              ))}
            </div>

            {/* Bulk action */}
            {pendingCount > 0 && (
              <Button
                variant="outline"
                className="w-full"
                size="lg"
                disabled={isPending}
                onClick={handleServeAll}
              >
                <CheckCheck className="mr-2 size-5" />
                {isPending
                  ? t("runner.inProgress")
                  : t("runner.serveAll", { count: pendingCount })}
              </Button>
            )}

            {pendingCount === 0 && (
              <p className="text-center text-sm font-medium text-green-600 dark:text-green-400">
                {t("runner.allServed")}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
