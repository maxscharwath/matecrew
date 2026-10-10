/** @jsxImportSource @matecrew/device-ui */
import {
  Screen,
  StatusBar,
  Main,
  Keys,
  Key,
  HStack,
  VStack,
  Surface,
  Small,
  P,
  Label,
  Large,
  Styled,
  Image,
  Media,
  Show,
  bind,
  and,
  eq,
  lt,
  ne,
  useI18n,
  type Children,
  type Dimension,
  type LayoutProps,
  type TextChildren,
} from "@matecrew/device-ui";
import { messages } from "../messages";

/** Dots shown at most; past them the screen says where the list is in words. */
const DOTS = 8;

/** Where a list is: one dot per page or item, the current one a pill. */
export function PageDots({ index, count }: Readonly<{ index: unknown; count: unknown }>) {
  return (
    <HStack gap={10} align="center">
      {Array.from({ length: DOTS }, (_, i) => [
        <Show key={`current-${i}`} when={eq(index, i)}>
          <Surface variant="ink" radius={7} width={28} height={14} />
        </Show>,
        <Show key={`other-${i}`} when={and(lt(i, count), ne(index, i))}>
          <Surface variant="outline" radius={7} width={14} height={14} />
        </Show>,
      ])}
    </HStack>
  );
}

/** The host's view data for the current screen. */
export const view = (key: string, fallback: unknown = "") => bind(`view.${key}`, fallback);
/** Keys are the host's business: the screen only reports which one was pressed. */
export const emit = (name: string) => ({ kind: "emit" as const, name });
/** The maté messages, translated on the device (see ../messages.ts). */
export const useT = () => useI18n(messages);

/**
 * Every maté screen: status bar, content, then the keys when the host labels them
 * (`view.left`, `view.right`, or the screen's own `left` / `right`). `primary` marks the
 * expected key.
 */
export function Frame({
  title,
  leading,
  trailing,
  keys = false,
  left = view("left"),
  right = view("right"),
  primary,
  reader = false,
  children,
  ...layout
}: Readonly<LayoutProps & {
  title: TextChildren;
  /** Before the title: the main screens show OWT's mark. */
  leading?: Children;
  trailing?: Children;
  keys?: boolean;
  left?: TextChildren;
  right?: TextChildren;
  primary?: "left" | "right";
  reader?: boolean;
  children?: Children;
}>) {
  const t = useT();
  return (
    <Screen theme="paper">
      <StatusBar leading={leading} trailing={trailing}>{title}</StatusBar>
      <Main {...layout}>{children}</Main>
      {keys && (
        <Keys reader={reader ? t("reader") : false}>
          {/* A label too long for its tab takes a smaller size rather than losing its end. */}
          <Key side="left" primary={primary === "left"} onPress={emit("left")}><Styled style="leadStrong" fit>{left}</Styled></Key>
          <Key side="right" primary={primary === "right"} onPress={emit("right")}><Styled style="leadStrong" fit>{right}</Styled></Key>
        </Keys>
      )}
    </Screen>
  );
}

/** A numbered instruction: an ink disc with the figure, then the sentence. */
export function Instruction({ n, children }: Readonly<{ n: number; children?: TextChildren }>) {
  return (
    <HStack gap={16}>
      <Surface variant="ink" radius={14} width={28} height={28} align="center" justify="center">
        <Small align="center">{String(n)}</Small>
      </Surface>
      <P lines={1} width="fill">{children}</P>
    </HStack>
  );
}

/**
 * Labelled values on a sunken band, one per line; `dense` fits twice as many (17 px values).
 * A value too long for its line takes a smaller size rather than losing its end: a network
 * name or an id is read, not skimmed.
 */
export function Facts({
  rows,
  dense = false,
  ...layout
}: Readonly<LayoutProps & { rows: [TextChildren, TextChildren][]; dense?: boolean; width?: Dimension; height?: Dimension }>) {
  return (
    <Surface variant="sunken" gap={dense ? 4 : 10} padding={dense ? [12, 20] : [16, 20]} width="fill" {...layout}>
      {rows.map(([label, value]) => (
        <HStack key={JSON.stringify(label)} gap={12}>
          <VStack width={128}>
            <Label>{label}</Label>
          </VStack>
          {dense ? (
            <Styled style="strong" lines={1} fit width="fill">{value}</Styled>
          ) : (
            <Large lines={1} fit width="fill">{value}</Large>
          )}
        </HStack>
      ))}
    </Surface>
  );
}

/**
 * An item's picture on a sunken disc of `size`, pixel for pixel, never magnified: `picture` is
 * 96 × 96 as the site draws it, `picture48` the same at half where there is less room.
 */
export function Picture({ value, size, half = false }: Readonly<{ value: unknown; size: number; half?: boolean }>) {
  const side = half ? 48 : 96;
  return (
    <Media size={size}>
      <Image width={side} height={side} sourceWidth={side} sourceHeight={side} value={value} />
    </Media>
  );
}

