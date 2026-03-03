"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CheckCheck, CupSoda, Clock } from "lucide-react";
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

interface SessionTab {
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
  readonly todaySessions: SessionTab[];
  readonly currentSessionId: string | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function SessionTabs({
  sessions,
  activeId,
  onSelect,
}: {
  readonly sessions: SessionTab[];
  readonly activeId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  if (sessions.length <= 1) return null;

  return (
    <div className="flex gap-1.5 rounded-lg bg-muted p-1">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
            activeId === s.id
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {s.label ?? s.startTime}
          <span className="ml-1.5 text-xs opacity-60">
            {s.startTime}–{s.cutoffTime}
          </span>
        </button>
      ))}
    </div>
  );
}

export function RunnerView({
  requests,
  date,
  officeId,
  todaySessions,
  currentSessionId,
}: RunnerViewProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(currentSessionId);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  const activeSession = todaySessions.find((s) => s.id === selectedSessionId);
  const filteredRequests = selectedSessionId
    ? requests.filter((r) => r.mateSessionId === selectedSessionId)
    : requests;

  const served = filteredRequests.filter((r) => r.status === "SERVED").length;
  const total = filteredRequests.length;
  const pendingCount = total - served;
  const pct = total === 0 ? 0 : Math.round((served / total) * 100);

  function handleServeAll() {
    startTransition(async () => {
      const result = await markAllServed(officeId, selectedSessionId);
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
        <h1 className="text-2xl font-bold">{t('runner.title')}</h1>
        <p className="text-muted-foreground">{formatDateDisplay(date)}</p>
      </div>

      {/* Session tabs */}
      <SessionTabs
        sessions={todaySessions}
        activeId={selectedSessionId}
        onSelect={setSelectedSessionId}
      />

      {/* Session status badge */}
      {activeSession && (
        <div className="flex items-center gap-2">
          <Clock className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {activeSession.label ?? t('runner.session')} {activeSession.startTime}–{activeSession.cutoffTime}
          </span>
          <Badge variant={activeSession.isOpen ? "default" : "secondary"} className="text-[10px]">
            {activeSession.isOpen ? t('runner.open') : t('runner.closed')}
          </Badge>
        </div>
      )}

      {/* Closed alert */}
      {activeSession && !activeSession.isOpen && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>{t('runner.ordersClosed')}</AlertTitle>
          <AlertDescription>
            {t('runner.ordersClosedDescription', { time: activeSession.cutoffTime })}
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
              {t('runner.noRequests')}
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
              {filteredRequests.map((r) => (
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
