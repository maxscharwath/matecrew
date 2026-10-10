/** @jsxImportSource @matecrew/device-ui */
/**
 * The office's stock at rest: what e-ink shows all day. One number dominates per item, its
 * week underneath as a sparkline; the keys start a take or show my consumption.
 */
import {
  HStack,
  VStack,
  Spacer,
  Separator,
  Show,
  Card,
  Badge,
  Stat,
  StatLabel,
  StatValue,
  H1,
  H3,
  Large,
  Small,
  Muted,
  Num,
  Spark,
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  OwtMark,
} from "@matecrew/device-ui";
import { CircleCheckBigIcon, HandPlatterIcon, PackageOpenIcon, TriangleAlertIcon } from "@matecrew/device-ui/icons/lucide";
import { Frame, Product, useT, view } from "./shared";

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

/** One item, alone: the number fills the screen. */
export function dashboardOne() {
  const t = useT();
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} keys primary="left" gap={20}>
      <HStack gap={40} height="fill">
        <Product value={item(0, "bits", [])} size={192} scale={6} />
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
        <Week index={0} height={72} />
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
        <Product value={item(index, "bits", [])} size={80} scale={3} />
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
      <Week index={index} height={48} />
    </Card>
  );
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} keys primary="left" direction="row" gap={20}>
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
        <Product value={item(index, "bits", [])} size={64} scale={2} />
        <VStack gap={6} width="fill">
          <Large>{item(index, "name")}</Large>
          <Low index={index} />
        </VStack>
        <Num size="md">{item(index, "stock")}</Num>
      </HStack>
      <Week index={index} height={36} />
    </VStack>
  );
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} keys primary="left" direction="row" gap={28}>
      <VStack gap={12} width="fill">
        <HStack gap={20}>
          <Product value={item(0, "bits", [])} size={112} scale={4} />
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
        <Week index={0} height={64} />
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

/** Four to six items, as tiles; the rest are counted. */
export function catalogue() {
  const t = useT();
  const tile = (index: number) => (
    <Show when={item(index, "visible", false)}>
      <Card variant={index === 0 ? "outline" : "sunken"} width="fill" height="fill" direction="row" gap={14} padding={16} align="center">
        <Product value={item(index, "bits", [])} size={64} scale={2} />
        <VStack gap={4} width="fill">
          <Small>{item(index, "name")}</Small>
          <Num size="sm">{item(index, "stock")}</Num>
        </VStack>
        <Show when={item(index, "low", false)}>
          <TriangleAlertIcon size={24} />
        </Show>
      </Card>
    </Show>
  );
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} keys primary="left" gap={16}>
      <HStack gap={16} align="stretch" height="fill">{[0, 1, 2].map(tile)}</HStack>
      <HStack gap={16} align="stretch" height="fill">{[3, 4, 5].map(tile)}</HStack>
      <Muted align="right">{t("more", { count: view("moreCount", 0) })}</Muted>
    </Frame>
  );
}

/** No item yet: say where they come from. */
export function empty() {
  const t = useT();
  return (
    <Frame title={view("title")} leading={<OwtMark size={28} />} keys primary="left">
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
      <Card variant="outline" width="fill" height={128} direction="row" gap={16} padding={[12, 16]} align="center">
        <Product value={row(i, "bits", [])} size={72} scale={2} />
        <VStack gap={2} width="fill">
          <HStack gap={10}>
            <Num size="sm">{row(i, "count", 0)}</Num>
            <Large lines={1} width="fill">{row(i, "name")}</Large>
          </HStack>
          <Muted lines={2}>{row(i, "names")}</Muted>
        </VStack>
      </Card>
    </Show>
  );
  // The right key is "Servi": a runner's badge closes the session (see core/src/flow.rs).
  return (
    <Frame title={view("title")} keys primary="right" gap={12}>
      <HStack gap={16}>
        <H3 width="fill">{view("preparation.title")}</H3>
        <Badge>{view("preparation.total")}</Badge>
      </HStack>
      <HStack gap={16}>{[0, 1].map(order)}</HStack>
      <HStack gap={16}>{[2, 3].map(order)}</HStack>
    </Frame>
  );
}

/** "Servi" and a runner's badge: the site served the session. */
export function served() {
  const t = useT();
  return (
    <Frame title={t("served.title")}>
      <Empty>
        <EmptyMedia variant="ink" size={128}><HandPlatterIcon size={64} strokeWidth={4} /></EmptyMedia>
        <H1 align="center">{t("served.heading", { count: view("count", 0) })}</H1>
        <Badge variant="secondary"><CircleCheckBigIcon size={18} /> {t("served.thanks", { name: view("name") })}</Badge>
      </Empty>
    </Frame>
  );
}
