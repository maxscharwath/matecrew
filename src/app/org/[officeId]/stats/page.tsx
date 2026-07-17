import { getTranslations, getLocale } from "next-intl/server";
import {
  Candy,
  CupSoda,
  Droplets,
  HeartPulse,
  Medal,
  Trophy,
  Users,
} from "lucide-react";
import { requireMembership } from "@/lib/auth-utils";
import {
  getOfficeStats,
  SUGAR_IDEAL_G_PER_DAY,
  SUGAR_MAX_G_PER_DAY,
  CAFFEINE_MODERATE_MG_PER_DAY,
  CAFFEINE_MAX_MG_PER_DAY,
  type RiskLevel,
  type UserStats,
} from "@/lib/stats";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MonthlyChart } from "@/components/stats/monthly-chart";
import { ItemsChart } from "@/components/stats/items-chart";
import { UsersChart } from "@/components/stats/users-chart";
import { cn } from "@/lib/utils";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function StatsPage({ params }: Props) {
  const { officeId } = await params;
  const { session } = await requireMembership(officeId);
  const t = await getTranslations();
  const locale = await getLocale();

  const stats = await getOfficeStats(officeId, session.user.id);
  const hasData = stats.totals.officeQty > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("stats.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("stats.subtitle")}</p>
      </div>

      {!hasData ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              <CupSoda className="size-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">{t("stats.empty")}</p>
              <p className="text-sm text-muted-foreground">
                {t("stats.emptyDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<CupSoda className="size-4 text-amber-500" />}
              label={t("stats.totalOffice")}
              value={stats.totals.officeQty.toLocaleString(locale)}
              hint={t("stats.cansUnit")}
            />
            <KpiCard
              icon={<CupSoda className="size-4 text-muted-foreground" />}
              label={t("stats.thisMonth")}
              value={stats.totals.monthOfficeQty.toLocaleString(locale)}
              hint={t("stats.cansUnit")}
            />
            <KpiCard
              icon={<Droplets className="size-4 text-sky-500" />}
              label={t("stats.litersTotal")}
              value={stats.totals.officeLiters.toLocaleString(locale, {
                maximumFractionDigits: 0,
              })}
              hint={t("stats.litersUnit")}
            />
            <KpiCard
              icon={<Users className="size-4 text-muted-foreground" />}
              label={t("stats.activeDrinkers")}
              value={String(stats.totals.activeDrinkers)}
              hint={t("stats.activeDrinkersHint")}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("stats.monthlyTitle")}</CardTitle>
              <CardDescription>{t("stats.monthlyDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <MonthlyChart
                data={stats.monthly}
                meLabel={t("stats.seriesMe")}
                othersLabel={t("stats.seriesOthers")}
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("stats.byItemTitle")}</CardTitle>
                <CardDescription>{t("stats.byItemDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <ItemsChart data={stats.byItem} otherLabel={t("stats.other")} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("stats.byUserTitle")}</CardTitle>
                <CardDescription>{t("stats.byUserDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <UsersChart
                  data={stats.users.map((u) => ({ name: u.name, qty: u.qty }))}
                  seriesLabel={t("stats.cansUnit")}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("stats.leaderboardTitle")}</CardTitle>
              <CardDescription>
                {t("stats.leaderboardDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Leaderboard
                users={stats.users}
                meId={session.user.id}
                locale={locale}
                cansUnit={t("stats.cansUnit")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("stats.healthTitle")}</CardTitle>
              <CardDescription>{t("stats.healthDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <HealthMeter
                  icon={<Candy className="size-4" />}
                  title={t("stats.diabetesRisk")}
                  valueLabel={t("stats.sugarPerDay", {
                    value: stats.me.avgSugarPerDay.toLocaleString(locale, {
                      maximumFractionDigits: 1,
                    }),
                  })}
                  ratio={stats.me.avgSugarPerDay / SUGAR_MAX_G_PER_DAY}
                  markerRatio={SUGAR_IDEAL_G_PER_DAY / SUGAR_MAX_G_PER_DAY}
                  level={stats.me.sugarRisk}
                  levelLabel={t(`stats.risk_${stats.me.sugarRisk}`)}
                  hint={t("stats.sugarLimitHint", {
                    ideal: SUGAR_IDEAL_G_PER_DAY,
                    max: SUGAR_MAX_G_PER_DAY,
                  })}
                />
                <HealthMeter
                  icon={<HeartPulse className="size-4" />}
                  title={t("stats.heartRisk")}
                  valueLabel={t("stats.caffeinePerDay", {
                    value: stats.me.avgCaffeinePerDay.toLocaleString(locale, {
                      maximumFractionDigits: 0,
                    }),
                  })}
                  ratio={stats.me.avgCaffeinePerDay / CAFFEINE_MAX_MG_PER_DAY}
                  markerRatio={
                    CAFFEINE_MODERATE_MG_PER_DAY / CAFFEINE_MAX_MG_PER_DAY
                  }
                  level={stats.me.caffeineRisk}
                  levelLabel={t(`stats.risk_${stats.me.caffeineRisk}`)}
                  hint={t("stats.caffeineLimitHint", {
                    max: CAFFEINE_MAX_MG_PER_DAY,
                  })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("stats.disclaimer")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("stats.nutritionTitle")}</CardTitle>
              <CardDescription>
                {t("stats.nutritionDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NutritionTable users={stats.users} locale={locale} t={t} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription>{label}</CardDescription>
          {icon}
        </div>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Leaderboard({
  users,
  meId,
  locale,
  cansUnit,
}: {
  users: UserStats[];
  meId: string;
  locale: string;
  cansUnit: string;
}) {
  const maxQty = users[0]?.qty ?? 1;

  return (
    <div className="space-y-1">
      {users.map((u, i) => {
        const rank = i + 1;
        return (
          <div
            key={u.userId}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2",
              u.userId === meId && "bg-accent/60",
            )}
          >
            <span className="flex w-7 shrink-0 items-center justify-center">
              {rank === 1 ? (
                <Trophy className="size-4.5 text-amber-500" />
              ) : rank === 2 ? (
                <Medal className="size-4.5 text-zinc-400" />
              ) : rank === 3 ? (
                <Medal className="size-4.5 text-amber-700" />
              ) : (
                <span className="text-sm font-medium text-muted-foreground tabular-nums">
                  {rank}
                </span>
              )}
            </span>
            <Avatar size="sm">
              <AvatarImage src={u.image} alt={u.name} />
              <AvatarFallback>{u.name.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{u.name}</p>
              <div className="mt-1 h-1 w-full max-w-56 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                  style={{ width: `${Math.max(2, (u.qty / maxQty) * 100)}%` }}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">
                {u.qty.toLocaleString(locale)}
              </p>
              <p className="text-xs text-muted-foreground">{cansUnit}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const RISK_BADGE_CLASSES: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300",
  moderate:
    "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300",
  high: "bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-500/15 dark:text-red-300",
};

const METER_FILL_CLASSES: Record<RiskLevel, string> = {
  low: "bg-emerald-500",
  moderate: "bg-amber-500",
  high: "bg-red-500",
};

function RiskBadge({
  icon,
  level,
  label,
}: {
  icon: React.ReactNode;
  level: RiskLevel;
  label: string;
}) {
  return (
    <Badge className={cn("gap-1 text-[10px]", RISK_BADGE_CLASSES[level])}>
      {icon}
      {label}
    </Badge>
  );
}

function HealthMeter({
  icon,
  title,
  valueLabel,
  ratio,
  markerRatio,
  level,
  levelLabel,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  valueLabel: string;
  /** Value as a fraction of the recommended maximum. */
  ratio: number;
  /** Where the "ideal" threshold sits on the track, as a fraction. */
  markerRatio: number;
  level: RiskLevel;
  levelLabel: string;
  hint: string;
}) {
  const pct = Math.min(100, Math.round(ratio * 100));

  return (
    <div className="space-y-2 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </span>
        <RiskBadge icon={null} level={level} label={levelLabel} />
      </div>
      <p className="text-2xl font-semibold">{valueLabel}</p>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", METER_FILL_CLASSES[level])}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-foreground/30"
          style={{ left: `${markerRatio * 100}%` }}
          aria-hidden
        />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function NutritionTable({
  users,
  locale,
  t,
}: {
  users: UserStats[];
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const nf = (value: number, digits = 1) =>
    value.toLocaleString(locale, { maximumFractionDigits: digits });

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("stats.colUser")}</TableHead>
            <TableHead className="text-right">{t("stats.colCans")}</TableHead>
            <TableHead className="text-right">{t("stats.colLiters")}</TableHead>
            <TableHead className="text-right">{t("stats.colSugar")}</TableHead>
            <TableHead className="text-right">
              {t("stats.colCaffeine")}
            </TableHead>
            <TableHead className="text-right">
              {t("stats.colSugarDay")}
            </TableHead>
            <TableHead className="text-right">
              {t("stats.colCaffeineDay")}
            </TableHead>
            <TableHead>{t("stats.colRisks")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.userId}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar size="sm">
                    <AvatarImage src={u.image} alt={u.name} />
                    <AvatarFallback>
                      {u.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium">{u.name}</span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {u.qty.toLocaleString(locale)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {nf(u.liters)} L
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {u.sugarGrams >= 1000
                  ? `${nf(u.sugarGrams / 1000, 2)} kg`
                  : `${nf(u.sugarGrams, 0)} g`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {u.caffeineMg >= 1000
                  ? `${nf(u.caffeineMg / 1000, 1)} g`
                  : `${nf(u.caffeineMg, 0)} mg`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {nf(u.avgSugarPerDay)} g
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {nf(u.avgCaffeinePerDay, 0)} mg
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <RiskBadge
                    icon={<Candy className="size-3" />}
                    level={u.sugarRisk}
                    label={t(`stats.risk_${u.sugarRisk}`)}
                  />
                  <RiskBadge
                    icon={<HeartPulse className="size-3" />}
                    level={u.caffeineRisk}
                    label={t(`stats.risk_${u.caffeineRisk}`)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
