/** @jsxImportSource @matecrew/device-ui */
/**
 * "Mon compte": the right key, a badge, then the site's live answer (`core::flow`,
 * `Screen::Account`). Read from across the room: today in ink, the week, the month and what it
 * cost (at the price the cans were bought), the last seven days as bars and the latest purchases.
 * The left key lists every purchase (`purchases.tsx`); nothing personal stays on the terminal.
 */
import {
  HStack,
  VStack,
  Label,
  Large,
  Small,
  Muted,
  Card,
  BarChart,
  Bar,
  Panel,
  Show,
  coalesce,
  concat,
  eq,
  lt,
  Stat,
  StatLabel,
  StatValue,
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  type TextChildren,
} from "@matecrew/device-ui";
import { LoaderCircleIcon, ReceiptIcon } from "@matecrew/device-ui/icons/lucide";
import { Frame, Picture, useT, view } from "./shared";

/** Stacked bar tones, bottom first, as the engine draws them (scene/charts.rs). */
const STACK = [100, 50, 25, 12];
/** Latest purchases shown: `flow::ACCOUNT_PURCHASES`. */
const RECENT = 2;

/** The site is asked for the account, or (`view.step` "cancel") to cancel a purchase. */
export function accountLoading() {
  const t = useT();
  return (
    <Frame title={concat(t("account.title"), " · ", view("name"))}>
      <Empty>
        <EmptyMedia>
          <LoaderCircleIcon size={56} strokeWidth={3} />
        </EmptyMedia>
        <EmptyTitle>{t("account.loading", { context: view("step") })}</EmptyTitle>
        <EmptyDescription>{t("account.wait")}</EmptyDescription>
      </Empty>
    </Frame>
  );
}

/** A figure on a card; the narrow ones shrink their label before they would cut it. */
function Tile({
  label,
  value,
  ink = false,
  size = "lg",
  weight = 5,
}: Readonly<{ label: TextChildren; value: TextChildren; ink?: boolean; size?: "sm" | "lg"; weight?: number }>) {
  return (
    <Card variant={ink ? "ink" : "outline"} width={{ fill: weight }} height="fill" padding={12}>
      <Stat>
        <StatLabel>{label}</StatLabel>
        <StatValue size={size}>{value}</StatValue>
      </Stat>
    </Card>
  );
}

const recent = (index: number, field: string, fallback: unknown = "") => view(`recent.${index}.${field}`, fallback);

/** One of the latest purchases: its picture at half, what and its price, then when. */
function Recent({ index }: Readonly<{ index: number }>) {
  return (
    <HStack gap={12} align="center" width="fill">
      <Picture value={recent(index, "picture", [])} size={48} half />
      <VStack gap={0} width="fill">
        <HStack gap={8} width="fill" align="center">
          <Large lines={1} fit width="fill">{recent(index, "item")}</Large>
          <Small>{recent(index, "price")}</Small>
        </HStack>
        <Muted lines={1}>{recent(index, "when")}</Muted>
      </VStack>
    </HStack>
  );
}

export function account() {
  const t = useT();
  return (
    <Frame
      title={concat(t("account.title"), " · ", view("name"))}
      keys
      left={t("account.purchases")}
      right={t("account.close")}
      gap={16}
    >
      <HStack gap={16} align="stretch" height={120}>
        <Tile label={t("account.today")} value={view("today", 0)} ink />
        <Tile label={t("account.week")} value={view("week", 0)} />
        <Tile label={t("account.month")} value={view("month", 0)} />
        <Tile label={t("account.cost")} value={coalesce(view("cost", null), "--")} size="sm" weight={6} />
      </HStack>
      <HStack gap={16} align="stretch" height="fill">
        <Card variant="outline" width={{ fill: 7 }} height="fill" padding={[12, 12, 12, 14]} gap={4}>
          <Label>{t("account.days")}</Label>
          <HStack gap={8} height="fill" width="fill">
            <BarChart data={view("days", [])} xKey="day" max={view("max", 4)} grid={false} legend={false} stacked>
              {STACK.map((tone, p) => <Bar key={tone} dataKey={`p${p}`} />)}
            </BarChart>
            {/* Beside the bars: the products' names would not fit under them. */}
            <VStack gap={8} justify="center" height="fill">
              {STACK.map((tone, p) => (
                <Show key={tone} when={view(`products.${p}`, "")}>
                  <HStack gap={6} align="center">
                    <Panel width={12} height={12} radius={3} borderWidth={1} background="ink" opacity={tone} />
                    <Muted lines={1}>{view(`products.${p}`)}</Muted>
                  </HStack>
                </Show>
              ))}
            </VStack>
          </HStack>
        </Card>
        <Card variant="outline" width={{ fill: 5 }} height="fill" padding={[12, 16]} gap={10}>
          <Label>{t("account.recent")}</Label>
          {Array.from({ length: RECENT }, (_, index) => (
            <Show key={index} when={lt(index, view("recentCount", 0))}>
              <Recent index={index} />
            </Show>
          ))}
          <Show when={eq(view("recentCount", 0), 0)}>
            <HStack gap={10} align="center" height="fill">
              <ReceiptIcon size={24} />
              <Muted>{t("account.none")}</Muted>
            </HStack>
          </Show>
        </Card>
      </HStack>
    </Frame>
  );
}
