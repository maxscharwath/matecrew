"use client";

import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CheckCheck, CupSoda, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { markAllServed } from "@/app/org/[officeId]/runner/actions";
import { formatDateDisplay } from "@/lib/date";

interface DailyRequest {
  id: string;
  status: "REQUESTED" | "SERVED";
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
  isToday,
  prevHref,
  nextHref,
  currentSessionHref,
}: {
  readonly date: Date;
  readonly session: SessionInfo | null;
  readonly isToday: boolean;
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

export function RunnerView({
  requests,
  date,
  officeId,
  session,
  isToday,
  prevHref,
  nextHref,
  currentSessionHref,
}: RunnerViewProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  const served = requests.filter((r) => r.status === "SERVED").length;
  const total = requests.length;
  const pendingCount = total - served;
  const pct = total === 0 ? 0 : Math.round((served / total) * 100);

  function handleServeAll() {
    startTransition(async () => {
      const result = await markAllServed(officeId, session?.id ?? null, date);
      if (result.success) {
        toast.success(t('runner.allServedToast'));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          {isToday ? t('runner.title') : t('runner.titlePast')}
        </h1>
        <SessionNavigator
          date={date}
          session={session}
          isToday={isToday}
          prevHref={prevHref}
          nextHref={nextHref}
          currentSessionHref={currentSessionHref}
        />
      </div>

      {/* Session status badge */}
      {isToday && session && (
        <div className="flex items-center gap-2">
          <Clock className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {session.label ?? t('runner.session')} {session.startTime}–{session.cutoffTime}
          </span>
          <Badge variant={session.isOpen ? "default" : "secondary"} className="text-[10px]">
            {session.isOpen ? t('runner.open') : t('runner.closed')}
          </Badge>
        </div>
      )}

      {/* Closed alert — only show for today */}
      {isToday && session && !session.isOpen && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>{t('runner.ordersClosed')}</AlertTitle>
          <AlertDescription>
            {t('runner.ordersClosedDescription', { time: session.cutoffTime })}
          </AlertDescription>
        </Alert>
      )}

      {/* Empty state */}
      {total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <CupSoda className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              {isToday ? t('runner.noRequests') : t('runner.noRequestsPast')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('runner.progress')}</span>
                <span className="font-medium">
                  {t('runner.servedCount', { served, total })}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Request list */}
            <div className="divide-y">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 py-2.5"
                >
                  <Avatar size="sm">
                    <AvatarImage src={r.user.image} alt={r.user.name} />
                    <AvatarFallback>{getInitials(r.user.name)}</AvatarFallback>
                  </Avatar>
                  <span className={`flex-1 text-sm ${r.status === "SERVED" ? "text-muted-foreground line-through" : "font-medium"}`}>
                    {r.user.name}
                  </span>
                  {r.status === "SERVED" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t('runner.waiting')}
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            {/* Serve all button */}
            {pendingCount > 0 && (
              <Button
                className="w-full"
                size="lg"
                disabled={isPending}
                onClick={handleServeAll}
              >
                <CheckCheck className="mr-2 h-5 w-5" />
                {isPending ? t('runner.inProgress') : t('runner.serveAll', { count: pendingCount })}
              </Button>
            )}

            {pendingCount === 0 && (
              <p className="text-center text-sm font-medium text-green-600 dark:text-green-400">
                {t('runner.allServed')}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
