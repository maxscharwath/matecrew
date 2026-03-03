"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, X, CupSoda, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  submitDailyRequest,
  cancelDailyRequest,
} from "@/app/org/[officeId]/request/actions";
import { formatDateDisplay } from "@/lib/date";

interface DailyRequest {
  id: string;
  officeId: string;
  status: "REQUESTED" | "SERVED";
}

interface OtherRequester {
  name: string;
  image?: string;
  status: "REQUESTED" | "SERVED";
}

interface SessionInfo {
  id: string;
  label: string | null;
  startTime: string;
  cutoffTime: string;
}

interface RequestViewProps {
  readonly officeId: string;
  readonly officeName: string;
  readonly date: Date;
  readonly existingRequest: DailyRequest | null;
  readonly otherRequesters: OtherRequester[];
  readonly cutoffTime: string | null;
  readonly cutoffPassed: boolean;
  readonly timezone: string;
  readonly totalRequested: number;
  readonly activeSession: SessionInfo | null;
  readonly nextSessionLabel: string | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const MAX_VISIBLE_AVATARS = 8;

function RequesterAvatars({
  requesters,
}: {
  readonly requesters: OtherRequester[];
}) {
  const t = useTranslations();
  if (requesters.length === 0) return null;

  const visible = requesters.slice(0, MAX_VISIBLE_AVATARS);
  const remaining = requesters.length - visible.length;

  return (
    <TooltipProvider>
      <AvatarGroup>
        {visible.map((r) => (
          <Tooltip key={r.name}>
            <TooltipTrigger asChild>
              <Avatar
                size="sm"
                className={
                  r.status === "SERVED" ? "ring-green-500!" : ""
                }
              >
                <AvatarImage src={r.image} alt={r.name} />
                <AvatarFallback>{getInitials(r.name)}</AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {r.name}
                {r.status === "SERVED" ? t('request.servedTooltip') : ""}
              </p>
            </TooltipContent>
          </Tooltip>
        ))}
        {remaining > 0 && (
          <AvatarGroupCount>+{remaining}</AvatarGroupCount>
        )}
      </AvatarGroup>
    </TooltipProvider>
  );
}

function StatusIcon({
  status,
}: {
  readonly status: "SERVED" | "REQUESTED" | null;
}) {
  if (status === "SERVED") {
    return (
      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-green-100 transition-colors dark:bg-green-900/40">
        <Check className="h-12 w-12 text-green-600 dark:text-green-400" />
      </div>
    );
  }

  if (status === "REQUESTED") {
    return (
      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-amber-100 transition-colors dark:bg-amber-900/40">
        <CupSoda className="h-12 w-12 text-amber-600 dark:text-amber-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-muted transition-colors">
      <CupSoda className="h-12 w-12 text-muted-foreground" />
    </div>
  );
}

function ServedState() {
  const t = useTranslations();
  return (
    <div className="space-y-2">
      <p className="text-lg font-medium text-green-700 dark:text-green-400">
        {t('request.mateServed')}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('request.mateServedDescription')}
      </p>
    </div>
  );
}

function RequestedState({
  isPending,
  onCancel,
}: {
  readonly isPending: boolean;
  readonly onCancel: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-lg font-medium text-amber-700 dark:text-amber-400">
          {t('request.mateRequested')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('request.mateRequestedDescription')}
        </p>
      </div>
      <Button variant="outline" disabled={isPending} onClick={onCancel}>
        <X className="mr-2 h-4 w-4" />
        {isPending ? t('request.cancelling') : t('request.cancelRequest')}
      </Button>
    </div>
  );
}

function EmptyState({
  isPending,
  cutoffPassed,
  onRequest,
}: {
  readonly isPending: boolean;
  readonly cutoffPassed: boolean;
  readonly onRequest: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {cutoffPassed
          ? t('request.ordersClosed')
          : t('request.wantMateToday')}
      </p>
      <Button
        size="lg"
        className="h-16 w-full text-lg"
        disabled={isPending || cutoffPassed}
        onClick={onRequest}
      >
        <CupSoda className="mr-2 h-5 w-5" />
        {isPending ? t('request.inProgress') : t('request.iWantMate')}
      </Button>
    </div>
  );
}

function useCountdown(cutoffTime: string, timezone: string) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    function calc() {
      const nowStr = new Date().toLocaleString("en-US", { timeZone: timezone });
      const now = new Date(nowStr);
      const [h, m] = cutoffTime.split(":").map(Number);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);

      const diff = target.getTime() - now.getTime();
      if (diff <= 0) {
        setExpired(true);
        setRemaining("");
        return;
      }

      setExpired(false);
      const totalSec = Math.floor(diff / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      if (hours > 0) {
        setRemaining(`${hours}h ${String(mins).padStart(2, "0")}min`);
      } else if (mins > 0) {
        setRemaining(`${mins}min ${String(secs).padStart(2, "0")}s`);
      } else {
        setRemaining(`${secs}s`);
      }
    }

    calc();
    const interval = setInterval(calc, 1000);
    return () => clearInterval(interval);
  }, [cutoffTime, timezone]);

  return { remaining, expired };
}

function CutoffIndicator({
  cutoffTime,
  cutoffPassed,
  timezone,
}: {
  readonly cutoffTime: string;
  readonly cutoffPassed: boolean;
  readonly timezone: string;
}) {
  const t = useTranslations();
  const { remaining, expired } = useCountdown(cutoffTime, timezone);
  const isClosed = cutoffPassed || expired;

  return (
    <div className="flex items-center justify-center gap-1.5">
      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      <span
        className={`text-xs ${
          isClosed
            ? "font-medium text-destructive"
            : "text-muted-foreground"
        }`}
      >
        {isClosed
          ? t('request.orderClosedSince', { time: cutoffTime })
          : t('request.closingIn', { remaining })}
      </span>
    </div>
  );
}

export function RequestView({
  officeId,
  officeName,
  date,
  existingRequest,
  otherRequesters,
  cutoffTime,
  cutoffPassed,
  timezone,
  totalRequested,
  activeSession,
  nextSessionLabel,
}: RequestViewProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  function handleRequest() {
    startTransition(async () => {
      const result = await submitDailyRequest(officeId, date, activeSession?.id ?? null);
      if (result.success) {
        toast.success(t('request.mateRequestedToast'));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleCancel() {
    if (!existingRequest) return;
    startTransition(async () => {
      const result = await cancelDailyRequest(officeId, existingRequest.id);
      if (result.success) {
        toast.success(t('request.requestCancelledToast'));
      } else {
        toast.error(result.error);
      }
    });
  }

  const status = existingRequest?.status ?? null;

  return (
    <div className="space-y-6">
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-xl">{t('request.mateOfTheDay')}</CardTitle>
          <CardDescription>
            {officeName} — {formatDateDisplay(date)}
            {activeSession?.label && ` — ${activeSession.label}`}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <StatusIcon status={status} />

          {status === "SERVED" && <ServedState />}
          {status === "REQUESTED" && (
            <RequestedState isPending={isPending} onCancel={handleCancel} />
          )}
          {status === null && !activeSession && nextSessionLabel && (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                {t('request.noActiveSession')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('request.nextSession', { label: nextSessionLabel })}
              </p>
            </div>
          )}
          {status === null && (activeSession || !nextSessionLabel) && (
            <EmptyState
              isPending={isPending}
              cutoffPassed={cutoffPassed || !activeSession}
              onRequest={handleRequest}
            />
          )}

          {cutoffTime && (
            <CutoffIndicator
              cutoffTime={cutoffTime}
              cutoffPassed={cutoffPassed}
              timezone={timezone}
            />
          )}
        </CardContent>
      </Card>

      {/* Who wants maté section */}
      {totalRequested > 0 && (
        <Card className="mx-auto max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{t('request.whoWantsMate')}</p>
              <Badge variant="secondary" className="text-xs">
                {t('request.requestCount', { count: totalRequested })}
              </Badge>
            </div>
            <Separator className="my-3" />
            {otherRequesters.length > 0 ? (
              <RequesterAvatars requesters={otherRequesters} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('request.onlyOneForNow')}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
