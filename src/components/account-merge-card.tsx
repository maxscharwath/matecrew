"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import {
  CupSoda,
  GitMerge,
  HandCoins,
  ListChecks,
  MailCheck,
  Slack,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { mergeAccountsAction } from "@/app/org/[officeId]/admin/accounts/actions";

export interface MergeCandidate {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  slackLinked: boolean;
  emailVerified: boolean;
  createdAt: string;
  counts: {
    memberships: number;
    dailyRequests: number;
    consumptionEntries: number;
    reimbursementLines: number;
  };
}

interface AccountMergeCardProps {
  readonly officeId: string;
  readonly group: { key: string; users: MergeCandidate[] };
}

export function AccountMergeCard({ officeId, group }: AccountMergeCardProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  // Default to keeping the oldest account (first, since groups are oldest-first).
  const [selectedId, setSelectedId] = useState(group.users[0]?.id ?? "");
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Derive the effective selection so a stale id (e.g. the chosen account got
  // merged away after revalidation) falls back to the first one — no effect.
  const targetId = group.users.some((u) => u.id === selectedId)
    ? selectedId
    : group.users[0]?.id ?? "";
  const setTargetId = setSelectedId;

  const sources = useMemo(
    () => group.users.filter((u) => u.id !== targetId),
    [group.users, targetId]
  );

  function initials(name: string) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  function handleRadioKeyDown(e: React.KeyboardEvent, index: number) {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next =
      (index + delta + group.users.length) % group.users.length;
    const nextUser = group.users[next];
    setTargetId(nextUser.id);
    rowRefs.current[nextUser.id]?.focus();
  }

  function handleMerge() {
    setConfirmOpen(false);
    const toMerge = sources;
    startTransition(async () => {
      setProgress({ done: 0, total: toMerge.length });
      let done = 0;
      for (const source of toMerge) {
        const result = await mergeAccountsAction(officeId, targetId, source.id);
        if (!result.success) {
          toast.error(
            done > 0
              ? t("accounts.mergePartial", {
                  done,
                  total: toMerge.length,
                  error: result.error,
                })
              : result.error
          );
          setProgress(null);
          return;
        }
        done += 1;
        setProgress({ done, total: toMerge.length });
      }
      setProgress(null);
      toast.success(t("accounts.mergeSuccess"));
    });
  }

  const target = group.users.find((u) => u.id === targetId);

  const buttonLabel = isPending
    ? progress
      ? t("accounts.mergingProgress", {
          done: progress.done,
          total: progress.total,
        })
      : t("accounts.merging")
    : t("accounts.mergeButton", { count: sources.length });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-5 w-5" aria-hidden />
          <span className="font-mono text-sm">{group.key}</span>
          <Badge variant="secondary">
            {t("accounts.accountsCount", { count: group.users.length })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          role="radiogroup"
          aria-label={t("accounts.keepGroupLabel")}
          className="space-y-2"
        >
          {group.users.map((u, index) => {
            const isTarget = u.id === targetId;
            return (
              <button
                key={u.id}
                ref={(el) => {
                  rowRefs.current[u.id] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isTarget}
                tabIndex={isTarget ? 0 : -1}
                disabled={isPending}
                onClick={() => setTargetId(u.id)}
                onKeyDown={(e) => handleRadioKeyDown(e, index)}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                  isTarget
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted/50"
                }`}
              >
                <Avatar>
                  <AvatarImage src={u.avatarUrl} alt="" />
                  <AvatarFallback className="text-xs">
                    {initials(u.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{u.name}</span>
                    {isTarget && (
                      <Badge variant="default">{t("accounts.keepBadge")}</Badge>
                    )}
                    {u.slackLinked && (
                      <>
                        <Slack
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="sr-only">
                          {t("accounts.slackLinked")}
                        </span>
                      </>
                    )}
                    {u.emailVerified && (
                      <>
                        <MailCheck
                          className="size-3.5 text-emerald-600"
                          aria-hidden
                        />
                        <span className="sr-only">
                          {t("accounts.emailVerified")}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {u.email}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span
                      className="flex items-center gap-1"
                      aria-label={t("accounts.countMemberships", {
                        count: u.counts.memberships,
                      })}
                    >
                      <Users className="size-3" aria-hidden />
                      {u.counts.memberships}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      aria-label={t("accounts.countRequests", {
                        count: u.counts.dailyRequests,
                      })}
                    >
                      <ListChecks className="size-3" aria-hidden />
                      {u.counts.dailyRequests}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      aria-label={t("accounts.countConsumption", {
                        count: u.counts.consumptionEntries,
                      })}
                    >
                      <CupSoda className="size-3" aria-hidden />
                      {u.counts.consumptionEntries}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      aria-label={t("accounts.countReimbursements", {
                        count: u.counts.reimbursementLines,
                      })}
                    >
                      <HandCoins className="size-3" aria-hidden />
                      {u.counts.reimbursementLines}
                    </span>
                    <span>
                      {t("accounts.createdOn", {
                        date: new Date(u.createdAt).toLocaleDateString(locale),
                      })}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end pt-1">
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={isPending || sources.length === 0}
          >
            <GitMerge className="mr-2 size-4" aria-hidden />
            {buttonLabel}
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleMerge}
        title={t("accounts.confirmTitle")}
        description={t("accounts.confirmDescription", {
          count: sources.length,
          email: target?.email ?? "",
        })}
        confirmLabel={t("accounts.confirmMerge")}
        confirmVariant="destructive"
        isPending={isPending}
      />
    </Card>
  );
}
