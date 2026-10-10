/** @jsxImportSource @matecrew/device-ui */
/**
 * A take, from the key to the confirmation: badge, choose, done. One decision per screen,
 * the expected key in ink.
 */
import {
  HStack,
  VStack,
  Label,
  H1,
  Lead,
  Num,
  Muted,
  Badge,
  Card,
  BarChart,
  Bar,
  Panel,
  Show,
  Surface,
  concat,
  and,
  eq,
  lt,
  ne,
  Stat,
  StatLabel,
  StatValue,
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  type TextChildren,
} from "@matecrew/device-ui";
import { CircleCheckBigIcon, ClockIcon, DoorOpenIcon, GlobeIcon } from "@matecrew/device-ui/icons/lucide";
import { BadgeOverReader } from "../art";
import { Frame, Picture, useT, view } from "./shared";

/** After a key: the badge goes on the reader, right under the middle of the screen. */
export function badge() {
  const t = useT();
  return (
    <Frame title={view("title")} keys reader align="center" justify="center" gap={8}>
      <BadgeOverReader width={240} height={200} />
      <H1 align="center">{t("badge.heading")}</H1>
      <Lead align="center">{t("badge.hint")}</Lead>
    </Frame>
  );
}

/** Dots shown at most; past them the "2/12" above says where the list is. */
const DOTS = 8;

/** Where the list is: one dot per item, the current one filled. */
const Pages = () => (
  <HStack gap={10} align="center">
    {Array.from({ length: DOTS }, (_, i) => [
      <Show when={eq(view("index", 0), i)}>
        <Surface variant="ink" radius={7} width={28} height={14} />
      </Show>,
      <Show when={and(lt(i, view("count", 0)), ne(view("index", 0), i))}>
        <Surface variant="outline" radius={7} width={14} height={14} />
      </Show>,
    ])}
  </HStack>
);

/** Choose what to take; the left key steps through the items, the right one takes this one. */
export function pick() {
  const t = useT();
  return (
    <Frame title={view("title")} keys primary="right" gap={12}>
      <HStack gap={36} height="fill" align="center">
        <Picture value={view("picture", [])} size={168} />
        <VStack gap={12} width="fill">
          <Label>{t("pick.label", { position: view("status") })}</Label>
          <H1 fit lines={2}>{view("item")}</H1>
          <HStack gap={12} align="center">
            <Num size="md">{view("stock")}</Num>
            <Lead>{t("pick.inStock")}</Lead>
          </HStack>
        </VStack>
      </HStack>
      <HStack justify="center" width="fill">
        <Pages />
      </HStack>
    </Frame>
  );
}

/** Nothing for me: step through the items again, or leave. */
export function leave() {
  const t = useT();
  return (
    <Frame title={view("title")} keys primary="right">
      <Empty>
        <EmptyMedia size={144}><DoorOpenIcon size={72} strokeWidth={4} /></EmptyMedia>
        <EmptyTitle>{t("leave.heading")}</EmptyTitle>
        <EmptyDescription>{t("leave.text")}</EmptyDescription>
      </Empty>
    </Frame>
  );
}

/** Done: who, what, and the way back. */
export function taken() {
  const t = useT();
  return (
    <Frame title={view("item")}>
      <Empty>
        <EmptyMedia variant="ink" size={128}><CircleCheckBigIcon size={64} strokeWidth={4} /></EmptyMedia>
        <H1 align="center">{t("taken.heading", { name: view("name") })}</H1>
        <Badge variant="secondary"><ClockIcon size={18} /> {t("taken.back")}</Badge>
      </Empty>
    </Frame>
  );
}

/** Stacked bar tones, bottom first, as the engine draws them (scene/charts.rs). */
const STACK = [100, 50, 25, 12];

/**
 * My consumption, read from across the room: today in ink, the week, the month and what it cost
 * (at the price the cans were bought), then the last seven days as bars.
 */
export function summary() {
  const t = useT();
  const tile = (label: TextChildren, value: TextChildren, { ink = false, size = "lg" as "xs" | "lg", weight = 5 } = {}) => (
    <Card variant={ink ? "ink" : "outline"} width={{ fill: weight }} height="fill" padding={[14, 12]}>
      <Stat>
        <StatLabel>{label}</StatLabel>
        <StatValue size={size}>{value}</StatValue>
      </Stat>
    </Card>
  );
  return (
    <Frame title={concat(t("summary.title"), " · ", view("name"))} gap={16}>
      <HStack gap={16} align="stretch" height={124}>
        {tile(t("summary.today"), view("today", 0), { ink: true })}
        {tile(t("summary.week"), view("week", 0))}
        {tile(t("summary.month"), view("month", 0))}
        {tile(t("summary.cost"), view("cost", "--"), { size: "sm", weight: 6 })}
      </HStack>
      <Card variant="outline" width="fill" height="fill" padding={[12, 16]} gap={6}>
        <HStack gap={16}>
          <Label width="fill">{t("summary.days")}</Label>
          {STACK.map((tone, p) => (
            <Show when={view(`products.${p}`, "")}>
              <HStack gap={6}>
                <Panel width={14} height={14} radius={3} borderWidth={1} background="ink" opacity={tone} />
                <Muted>{view(`products.${p}`)}</Muted>
              </HStack>
            </Show>
          ))}
        </HStack>
        <BarChart data={view("days", [])} xKey="day" max={view("max", 4)} grid={false} legend={false} stacked>
          {STACK.map((_, p) => <Bar dataKey={`p${p}`} />)}
        </BarChart>
      </Card>
      <HStack gap={12}>
        <GlobeIcon size={20} />
        <Muted>{t("summary.more")}</Muted>
      </HStack>
    </Frame>
  );
}

