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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ItemThumb } from "@/components/item-thumb";
import {
  submitDailyRequest,
  cancelDailyRequest,
} from "@/app/org/[officeId]/request/actions";
import { takeACan } from "@/app/org/[officeId]/dashboard/actions";
import { formatDateDisplay } from "@/lib/date";

interface DailyRequest {
  id: string;
  officeId: string;
  status: "REQUESTED" | "SERVED";
  itemId: string;
}

interface Requester {
  name: string;
  image?: string;
  status: "REQUESTED" | "SERVED";
  itemName: string;
  isMe: boolean;
}

interface Item {
  id: string;
  name: string;
  imageUrl?: string;
  isDefault: boolean;
  sortOrder: number;
  stockQty: number;
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
  readonly items: Item[];
  readonly requesters: Requester[];
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
  readonly requesters: Requester[];
}) {
  const t = useTranslations();
  if (requesters.length === 0) return null;

  const visible = requesters.slice(0, MAX_VISIBLE_AVATARS);
  const remaining = requesters.length - visible.length;

  return (
    <TooltipProvider>
      <AvatarGroup>
        {visible.map((r) => {
          let ringClass = "";
          if (r.isMe) ringClass = "ring-amber-500!";
          else if (r.status === "SERVED") ringClass = "ring-green-500!";
          return (
            <Tooltip key={r.name}>
              <TooltipTrigger asChild>
                <Avatar size="sm" className={ringClass}>
                  <AvatarImage src={r.image} alt={r.name} />
                  <AvatarFallback>{getInitials(r.name)}</AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {r.isMe ? t('request.youLabel') : r.name}
                  {" · "}
                  {r.itemName}
                  {r.status === "SERVED" ? t('request.servedTooltip') : ""}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
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
  itemName,
}: {
  readonly isPending: boolean;
  readonly onCancel: () => void;
  readonly itemName: string | null;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-lg font-medium text-amber-700 dark:text-amber-400">
          {t('request.mateRequested')}
        </p>
        {itemName && (
          <Badge variant="secondary" className="gap-1">
            <CupSoda className="h-3 w-3" />
            {itemName}
          </Badge>
        )}
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

/**
 * Item chooser: a single big button when the office manages one item, or one
 * button per item when several are available.
 */
function ItemChoice({
  items,
  isPending,
  disabled,
  singleLabel,
  onPick,
}: {
  readonly items: Item[];
  readonly isPending: boolean;
  readonly disabled: boolean;
  readonly singleLabel: string;
  readonly onPick: (itemId: string) => void;
}) {
  const t = useTranslations();

  // Sold-out items are hidden as long as something is orderable; when nothing
  // is (or the office manages a single item), keep the informative disabled
  // sold-out button instead of an empty picker.
  const inStock = items.filter((i) => i.stockQty > 0);
  const choices = inStock.length > 0 ? inStock : items.slice(0, 1);

  if (choices.length <= 1) {
    const only = choices[0];
    const soldOut = !!only && only.stockQty <= 0;
    return (
      <Button
        size="lg"
        className="h-16 w-full text-lg"
        disabled={isPending || disabled || !only || soldOut}
        onClick={() => only && onPick(only.id)}
      >
        <CupSoda className="mr-2 h-5 w-5" />
        {soldOut
          ? t('request.outOfStock')
          : isPending
            ? t('request.inProgress')
            : singleLabel}
      </Button>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {choices.map((item) => {
        const soldOut = item.stockQty <= 0;
        return (
          <Button
            key={item.id}
            size="lg"
            variant="outline"
            className="h-auto items-center justify-start gap-3 py-3 text-left disabled:opacity-100"
            disabled={isPending || disabled || soldOut}
            onClick={() => onPick(item.id)}
          >
            <ItemThumb
              imageUrl={item.imageUrl}
              name={item.name}
              className={soldOut ? "opacity-60" : ""}
            />
            <span className="flex min-w-0 flex-col">
              <span
                className={`truncate text-base font-medium ${
                  soldOut ? "text-muted-foreground" : ""
                }`}
              >
                {item.name}
              </span>
              {soldOut && (
                <span className="text-xs font-normal text-muted-foreground">
                  {t('request.outOfStock')}
                </span>
              )}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function EmptyState({
  items,
  isPending,
  cutoffPassed,
  onRequest,
}: {
  readonly items: Item[];
  readonly isPending: boolean;
  readonly cutoffPassed: boolean;
  readonly onRequest: (itemId: string) => void;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {cutoffPassed
          ? t('request.ordersClosed')
          : items.filter((i) => i.stockQty > 0).length > 1
            ? t('request.pickYourMate')
            : t('request.wantMateToday')}
      </p>
      <ItemChoice
        items={items}
        isPending={isPending}
        disabled={cutoffPassed}
        singleLabel={t('request.iWantMate')}
        onPick={onRequest}
      />
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
  items,
  requesters,
  cutoffTime,
  cutoffPassed,
  timezone,
  totalRequested,
  activeSession,
  nextSessionLabel,
}: RequestViewProps) {
  const [isPending, startTransition] = useTransition();
  const [takeCanOpen, setTakeCanOpen] = useState(false);
  const [takeCanItemId, setTakeCanItemId] = useState<string | null>(null);
  const t = useTranslations();

  const requestedItemName =
    items.find((i) => i.id === existingRequest?.itemId)?.name ?? null;

  function handleRequest(itemId: string) {
    startTransition(async () => {
      const result = await submitDailyRequest(officeId, date, activeSession?.id ?? null, itemId);
      if (result.success) {
        toast.success(t('request.mateRequestedToast'));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleTakeCan(itemId: string) {
    // With a single item, take it immediately; otherwise confirm the pick.
    if (items.length <= 1) {
      handleTakeCanConfirm(itemId);
    } else {
      setTakeCanItemId(itemId);
      setTakeCanOpen(true);
    }
  }

  function handleTakeCanConfirm(itemId: string | null) {
    startTransition(async () => {
      const result = await takeACan(officeId, itemId);
      setTakeCanOpen(false);
      if (result.success) {
        toast.success(t('dashboard.canTaken'));
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
            <RequestedState
              isPending={isPending}
              onCancel={handleCancel}
              itemName={requestedItemName}
            />
          )}
          {status === null && !activeSession && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  {t('request.noActiveSession')}
                </p>
                {nextSessionLabel && (
                  <p className="text-sm text-muted-foreground">
                    {t('request.nextSession', { label: nextSessionLabel })}
                  </p>
                )}
              </div>
              <ItemChoice
                items={items}
                isPending={isPending}
                disabled={false}
                singleLabel={t('dashboard.takeCan')}
                onPick={handleTakeCan}
              />
            </div>
          )}
          {status === null && activeSession && (
            <EmptyState
              items={items}
              isPending={isPending}
              cutoffPassed={cutoffPassed}
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
            <RequesterAvatars requesters={requesters} />
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={takeCanOpen}
        onOpenChange={setTakeCanOpen}
        onConfirm={() => handleTakeCanConfirm(takeCanItemId)}
        title={t('dashboard.takeCanConfirmTitle')}
        description={
          items.find((i) => i.id === takeCanItemId)
            ? t('dashboard.takeCanConfirmItem', {
                item: items.find((i) => i.id === takeCanItemId)!.name,
              })
            : t('dashboard.takeCanConfirmDescription')
        }
        confirmLabel={t('dashboard.takeCan')}
        confirmVariant="default"
        isPending={isPending}
      />
    </div>
  );
}
