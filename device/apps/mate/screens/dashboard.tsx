/** @jsxImportSource @matecrew/device-ui */
/**
 * The office's stock at rest: what e-ink shows all day. One number dominates per item, its
 * week underneath as a sparkline; a badge on the reader opens the menu (take, my account).
 */
import {
  HStack,
  VStack,
  Spacer,
  Separator,
  Show,
  Card,
  Surface,
  Badge,
  Stat,
  StatLabel,
  StatValue,
  H1,
  H3,
  Large,
  Small,
  Footnote,
  Muted,
  Num,
  Spark,
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  OwtMark,
  concat,
  lt,
  ne,
  not,
  type Children,
} from "@matecrew/device-ui";
import { CircleCheckBigIcon, HandPlatterIcon, PackageOpenIcon, TriangleAlertIcon } from "@matecrew/device-ui/icons/lucide";
import { Avatar, Frame, Picture, useT, view } from "./shared";

/** People with their avatar on an order's card: as many as the site sends (PREPARATION_PEOPLE). */
const PEOPLE = 5;
/** How far each avatar of an order's stack covers the one before: initials stay whole. */
const STACK_OVERLAP = 6;

/** A 32 px avatar on a ring of paper: in a stack, the ring parts it from the one it covers. */
const Ring = ({ children }: { children: Children }) => (
  <Surface variant="paper" radius={18} width={36} height={36} align="center" justify="center">
    {children}
  </Surface>
);

const item = (index: number, field: string, fallback: unknown = "") => view(`items.${index}.${field}`, fallback);

/** "Stock bas", only when the host flags the item. */
const Low = ({ index }: { index: number }) => (
  <Show when={item(index, "low", false)}>
    <Badge><TriangleAlertIcon size={18} /> {view("lowLabel", "Stock bas")}</Badge>
  </Show>
);

/** The item's last days on the shared scale. */
const Week = ({ index, height }: { index: number; height: number }) => (
  <Spark value={view(`chart.series.${index}`, [])} max={view("chart.max", 1)} height={height} />
);

/** The item's last days, with when they start and end in small under the line. */
const Trend = ({ index, height }: { index: number; height: number }) => {
  const t = useT();
  return (
    <VStack gap={2} width="fill">
      <Week index={index} height={height} />
      <HStack width="fill">
        <Footnote>{t("chart.ago", { count: view("chart.days", 14) })}</Footnote>
        <Spacer />
        <Footnote>{t("chart.today")}</Footnote>
      </HStack>
    </VStack>
  );
};

/** One item, alone: the number fills the screen. */
export function dashboardOne() {
  const t = useT();
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} dated start gap={20}>
      <HStack gap={40} height="fill">
        <Picture value={item(0, "picture", [])} size={144} />
        <VStack gap={12} width="fill">
          <Stat>
            <StatLabel>{t("inStock")}</StatLabel>
            <StatValue size="2xl">{item(0, "stock")}</StatValue>
          </Stat>
          <H3>{item(0, "name")}</H3>
          <Low index={0} />
        </VStack>
      </HStack>
      <VStack gap={8}>
        <Muted>{view("chartLabel")}</Muted>
        <Trend index={0} height={64} />
      </VStack>
    </Frame>
  );
}

/** Two items, two cards. */
export function dashboardTwo() {
  const t = useT();
  const column = (index: number) => (
    <Card width="fill" height="fill" gap={12}>
      <HStack gap={16}>
        <Picture value={item(index, "picture", [])} size={104} />
        <VStack gap={8} width="fill">
          <Large>{item(index, "name")}</Large>
          <Low index={index} />
        </VStack>
      </HStack>
      <Stat>
        <StatLabel>{t("inStock")}</StatLabel>
        <StatValue size="xl">{item(index, "stock")}</StatValue>
      </Stat>
      <Spacer />
      <Trend index={index} height={40} />
    </Card>
  );
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} dated start direction="row" gap={20}>
      {column(0)}
      {column(1)}
    </Frame>
  );
}

/** Three items: the first as the hero, the others as rows. */
export function dashboard() {
  const t = useT();
  const row = (index: number) => (
    <VStack gap={6} width="fill">
      <HStack gap={16}>
        <Picture value={item(index, "picture48", [])} size={64} half />
        <VStack gap={6} width="fill">
          <Large>{item(index, "name")}</Large>
          <Low index={index} />
        </VStack>
        <Num size="md">{item(index, "stock")}</Num>
      </HStack>
      <Trend index={index} height={28} />
    </VStack>
  );
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} dated start direction="row" gap={28}>
      <VStack gap={12} width="fill">
        <HStack gap={20}>
          <Picture value={item(0, "picture", [])} size={112} />
          <Stat>
            <StatLabel>{t("inStock")}</StatLabel>
            <StatValue size="2xl">{item(0, "stock")}</StatValue>
          </Stat>
        </HStack>
        <HStack gap={12}>
          <H3>{item(0, "name")}</H3>
          <Low index={0} />
        </HStack>
        <Spacer />
        <Muted>{view("chartLabel")}</Muted>
        <Trend index={0} height={56} />
      </VStack>
      <Separator vertical />
      <VStack gap={16} width="fill" justify="between">
        {row(1)}
        <Separator dotted />
        {row(2)}
      </VStack>
    </Frame>
  );
}

/** Stock, with the warning sign when it runs low. */
const Stock = ({ index }: { index: number }) => (
  <HStack gap={8} align="center">
    <Num size="sm">{item(index, "stock")}</Num>
    <Show when={item(index, "low", false)}>
      <TriangleAlertIcon size={24} />
    </Show>
  </HStack>
);

/** Four items, two by two: a big picture, the name, the stock and its last days on each tile. */
export function catalogueFour() {
  const tile = (index: number) => (
    <Card variant={index === 0 ? "outline" : "hairline"} width="fill" height="fill" direction="row" gap={16} padding={14} align="center">
      <Picture value={item(index, "picture", [])} size={104} />
      <VStack gap={6} width="fill">
        <Small lines={2}>{item(index, "name")}</Small>
        <Stock index={index} />
        <Trend index={index} height={18} />
      </VStack>
    </Card>
  );
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} dated start gap={16}>
      <HStack gap={16} align="stretch" height="fill">{[0, 1].map(tile)}</HStack>
      <HStack gap={16} align="stretch" height="fill">{[2, 3].map(tile)}</HStack>
    </Frame>
  );
}

/** Five or six items, three by two; the rest are counted. */
export function catalogue() {
  const t = useT();
  const tile = (index: number) => (
    <Show when={item(index, "visible", false)}>
      <Card variant={index === 0 ? "outline" : "hairline"} width="fill" height="fill" gap={4} padding={[10, 12]}>
        <HStack gap={12} align="center" width="fill">
          <Picture value={item(index, "picture48", [])} size={64} half />
          <VStack gap={2} width="fill">
            <Small lines={2}>{item(index, "name")}</Small>
            <Stock index={index} />
          </VStack>
        </HStack>
        <Trend index={index} height={16} />
      </Card>
    </Show>
  );
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} dated start gap={12}>
      <HStack gap={12} align="stretch" height="fill">{[0, 1, 2].map(tile)}</HStack>
      <HStack gap={12} align="stretch" height="fill">{[3, 4, 5].map(tile)}</HStack>
      <Show when={view("moreCount", 0)}>
        <Muted align="right">{t("more", { count: view("moreCount", 0) })}</Muted>
      </Show>
    </Frame>
  );
}

/** No item yet: say where they come from. */
export function empty() {
  const t = useT();
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} dated start>
      <Empty>
        <EmptyMedia><PackageOpenIcon size={56} strokeWidth={3} /></EmptyMedia>
        <EmptyTitle>{t("empty.heading")}</EmptyTitle>
        <EmptyDescription>{t("empty.text")}</EmptyDescription>
      </Empty>
    </Frame>
  );
}

/** Before a session: who takes what, so the runner prepares it. */
export function preparation() {
  const row = (i: number, field: string, fallback: unknown = "") => view(`prepRows.${i}.${field}`, fallback);
  const order = (i: number) => (
    <Show when={row(i, "visible", false)}>
      <Card variant="outline" width="fill" height="fill" gap={8} padding={[10, 14]} justify="center">
        <HStack gap={16} align="center">
          <Picture value={row(i, "picture48", [])} size={64} half />
          {/* The product's whole name: two lines, then smaller, before an ellipsis. */}
          <HStack gap={10} align="start" width="fill">
            <Num size="sm">{row(i, "count", 0)}</Num>
            <Large lines={2} fit width="fill">{row(i, "name")}</Large>
          </HStack>
        </HStack>
        {/* Who, across the card: their avatars (or initials) stacked, the rest counted, their names
            8 px away (6, and the ring's 2 px of paper). */}
        <HStack gap={6} align="center">
          <HStack gap={-STACK_OVERLAP} align="center">
            {Array.from({ length: PEOPLE }, (_, j) => (
              <Show key={j} when={lt(j, row(i, "peopleCount", 0))}>
                <Ring><Avatar person={`prepRows.${i}.people.${j}`} size={32} /></Ring>
              </Show>
            ))}
            <Show when={ne(row(i, "more", 0), 0)}>
              <Ring>
                <Surface variant="outline" radius={16} width={32} height={32} align="center" justify="center">
                  <Small align="center">{concat("+", row(i, "more", 0))}</Small>
                </Surface>
              </Ring>
            </Show>
          </HStack>
          <Muted lines={1} width="fill">{row(i, "names")}</Muted>
        </HStack>
      </Card>
    </Show>
  );
  // A runner's badge, then the menu's right key "Servi", closes the session (see core/src/flow.rs).
  return (
    <Frame title={view("title")} start gap={12}>
      <HStack gap={16}>
        <H3 width="fill">{view("preparation.title")}</H3>
        <Badge>{view("preparation.total")}</Badge>
      </HStack>
      <HStack gap={16} height="fill">{[0, 1].map(order)}</HStack>
      <HStack gap={16} height="fill">{[2, 3].map(order)}</HStack>
    </Frame>
  );
}

/** "Servi" and a runner's badge: the site served the session. */
export function served() {
  const t = useT();
  return (
    <Frame title={t("served.title")}>
      <Empty>
        {/* The runner's avatar, else the served icon. */}
        <Show when={view("person.hasAvatar", false)}>
          <Avatar person="person" size={128} />
        </Show>
        <Show when={not(view("person.hasAvatar", false))}>
          <EmptyMedia variant="ink" size={128}><HandPlatterIcon size={64} strokeWidth={4} /></EmptyMedia>
        </Show>
        <H1 align="center">{t("served.heading", { count: view("count", 0) })}</H1>
        <Badge variant="secondary"><CircleCheckBigIcon size={18} /> {t("served.thanks", { name: view("name") })}</Badge>
      </Empty>
    </Frame>
  );
}
