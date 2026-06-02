import { getTranslations } from "next-intl/server";
import { findDuplicateAccountGroups } from "@/lib/account-merge";
import { getDomainAliasGroups } from "@/lib/email-identity";
import { resolveAvatarUrl } from "@/lib/storage";
import { AccountMergeCard } from "@/components/account-merge-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2 } from "lucide-react";

interface SectionProps {
  readonly officeId: string;
}

export function DuplicatesFallback() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-56" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 2 }).map((__, j) => (
              <div
                key={j}
                className="flex items-center justify-between rounded-md border px-3 py-3"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div>
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="mt-1 h-3 w-52" />
                  </div>
                </div>
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export async function DuplicatesSection({ officeId }: SectionProps) {
  const t = await getTranslations();
  const groups = await findDuplicateAccountGroups();

  const aliasGroups = getDomainAliasGroups();

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
          <CheckCircle2 className="size-5 text-emerald-600" />
          <span>{t("accounts.noDuplicates")}</span>
        </CardContent>
      </Card>
    );
  }

  const cards = await Promise.all(
    groups.map(async (group) => ({
      key: group.key,
      users: await Promise.all(
        group.users.map(async (u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: resolveAvatarUrl(u.image),
          slackLinked: u.slackUserId !== null,
          emailVerified: u.emailVerified,
          createdAt: u.createdAt.toISOString(),
          counts: u.counts,
        }))
      ),
    }))
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("accounts.aliasGroups")}:{" "}
        {aliasGroups.map((g) => g.join(" = ")).join(" · ")}
      </p>
      {cards.map((group) => (
        <AccountMergeCard key={group.key} officeId={officeId} group={group} />
      ))}
    </div>
  );
}
