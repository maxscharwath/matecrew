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
  bind,
  useI18n,
  type Children,
  type LayoutProps,
  type TextChildren,
} from "@matecrew/device-ui";
import { messages } from "../messages";

/** The host's view data for the current screen. */
export const view = (key: string, fallback: unknown = "") => bind(`view.${key}`, fallback);
/** Keys are the host's business: the screen only reports which one was pressed. */
export const emit = (name: string) => ({ kind: "emit" as const, name });
/** The maté messages, translated on the device (see ../messages.ts). */
export const useT = () => useI18n(messages);

/**
 * Every maté screen: status bar, content, then the keys when the host labels them
 * (`view.left`, `view.right`). `primary` marks the expected key.
 */
export function Frame({
  title,
  leading,
  trailing,
  keys = false,
  primary,
  reader = false,
  children,
  ...layout
}: LayoutProps & {
  title: TextChildren;
  /** Before the title: the main screens show OWT's mark. */
  leading?: Children;
  trailing?: Children;
  keys?: boolean;
  primary?: "left" | "right";
  reader?: boolean;
  children?: Children;
}) {
  const t = useT();
  return (
    <Screen theme="paper">
      <StatusBar leading={leading} trailing={trailing}>{title}</StatusBar>
      <Main {...layout}>{children}</Main>
      {keys && (
        <Keys reader={reader ? t("reader") : false}>
          <Key side="left" primary={primary === "left"} onPress={emit("left")}>{view("left")}</Key>
          <Key side="right" primary={primary === "right"} onPress={emit("right")}>{view("right")}</Key>
        </Keys>
      )}
    </Screen>
  );
}

/** A numbered instruction: an ink disc with the figure, then the sentence. */
export function Instruction({ n, children }: { n: number; children?: TextChildren }) {
  return (
    <HStack gap={16}>
      <Surface variant="ink" radius={14} width={28} height={28} align="center" justify="center">
        <Small align="center">{String(n)}</Small>
      </Surface>
      <P lines={1} width="fill">{children}</P>
    </HStack>
  );
}

/** Labelled values on a sunken band, one per line; `dense` fits twice as many (17 px values). */
export function Facts({ rows, dense = false, ...layout }: LayoutProps & { rows: [TextChildren, TextChildren][]; dense?: boolean }) {
  return (
    <Surface variant="sunken" gap={dense ? 4 : 10} padding={dense ? [12, 20] : [16, 20]} width="fill" {...layout}>
      {rows.map(([label, value]) => (
        <HStack gap={12}>
          <VStack width={128}>
            <Label>{label}</Label>
          </VStack>
          {dense ? (
            <Styled style="strong" lines={1} width="fill">{value}</Styled>
          ) : (
            <Large lines={1} width="fill">{value}</Large>
          )}
        </HStack>
      ))}
    </Surface>
  );
}

/** A 24 × 24 product picture from the site, magnified on a sunken disc. */
export function Product({ value, size, scale }: { value: unknown; size: number; scale: number }) {
  return (
    <Media size={size}>
      <Image width={24 * scale} height={24 * scale} sourceWidth={24} sourceHeight={24} value={value} />
    </Media>
  );
}
