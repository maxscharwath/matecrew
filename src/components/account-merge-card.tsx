"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  CupSoda,
  GitMerge,
  HandCoins,
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

interface Candidate {
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
    purchaseBatches: number;
    reimbursementLines: number;
    stockMovements: number;
    sessions: number;
    accounts: number;
  };
}

interface AccountMergeCardProps {
  readonly officeId: string;
  readonly group: { key: string; users: Candidate[] };
}

export function AccountMergeCard({ officeId, group }: AccountMergeCardProps) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Default to keeping the oldest account (first, since groups are oldest-first).
  const [targetId, setTargetId] = useState(group.users[0]?.id ?? "");

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

  function handleMerge() {
    setConfirmOpen(false);
    startTransition(async () => {
      for (const source of sources) {
        const result = await mergeAccountsAction(officeId, targetId, source.id);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
      }
      toast.success(t("accounts.mergeSuccess"));
    });
  }

  const target = group.users.find((u) => u.id === targetId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" />
          <span className="font-mono text-sm">{group.key}</span>
          <Badge variant="secondary">
            {t("accounts.accountsCount", { count: group.users.length })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {group.users.map((u) => {
          const isTarget = u.id === targetId;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => setTargetId(u.id)}
              aria-pressed={isTarget}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                isTarget
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "hover:bg-muted/50"
              }`}
            >
              <Avatar className="size-9">
                <AvatarImage src={u.avatarUrl} alt={u.name} />
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
                    <Slack className="size-3.5 text-muted-foreground" />
                  )}
                  {u.emailVerified && (
                    <MailCheck className="size-3.5 text-emerald-600" />
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="size-3" />
                    {u.counts.memberships}
                  </span>
                  <span className="flex items-center gap-1">
                    <CupSoda className="size-3" />
                    {u.counts.consumptionEntries}
                  </span>
                  <span className="flex items-center gap-1">
                    <HandCoins className="size-3" />
                    {u.counts.reimbursementLines}
                  </span>
                  <span>{t("accounts.createdOn", {
                    date: new Date(u.createdAt).toLocaleDateString(),
                  })}</span>
                </div>
              </div>
            </button>
          );
        })}

        <div className="flex justify-end pt-1">
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={isPending || sources.length === 0}
          >
            <GitMerge className="mr-2 size-4" />
            {isPending
              ? t("accounts.merging")
              : t("accounts.mergeButton", { count: sources.length })}
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
        confirmVariant="default"
        isPending={isPending}
      />
    </Card>
  );
}
