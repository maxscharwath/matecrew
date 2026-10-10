/** @jsxImportSource ../runtime */
/**
 * The terminal's frame: a status bar, the main area, and the two keys under the panel.
 *
 *   <Screen>
 *     <StatusBar>Lausanne</StatusBar>
 *     <Main>…</Main>
 *     <Keys reader>
 *       <Key side="left" primary onPress={take}>Prendre</Key>
 *       <Key side="right" onPress={mine}>Ma conso</Key>
 *     </Keys>
 *   </Screen>
 */
import { Button as Pressable, Group, HStack, Image, Stack, VStack, bind, type Children, type Content, type Handler, type TextChildren } from "../runtime/jsx-runtime";
import type { Element, Node } from "../runtime/types";
import type { LayoutProps } from "../runtime/layout";
import { ArrowDownIcon, NfcIcon } from "../icons/lucide";
import { KEYS, MARGIN, SCREEN, STATUS, TABS } from "./tokens";
import { Overlay, Separator, Surface } from "./surface";
import { Label, Large, Muted, inline } from "./typography";

/**
 * What this screen is, on the left; the time, Wi-Fi and battery the host reports on the right
 * (or `trailing`, e.g. setup steps). A hairline closes it.
 */
export function StatusBar({
  children,
  leading,
  trailing,
  status = true,
}: {
  children?: TextChildren;
  /** Before the title, such as a mark. */
  leading?: Children;
  trailing?: Children;
  status?: boolean;
}): Element {
  return (
    <VStack padding={[0, MARGIN]} height={STATUS} width="fill">
      <HStack gap={16} align="center" height="fill" width="fill">
        {leading}
        <Large lines={1} width="fill">{children}</Large>
        {trailing ?? (status ? (
          <HStack gap={10} align="center">
            <Large>{bind("$device.clock", "--:--")}</Large>
            <Image width={24} height={24} sourceWidth={24} sourceHeight={24} value={bind("$device.status.wifi", [])} />
            <Image width={24} height={24} sourceWidth={24} sourceHeight={24} value={bind("$device.status.battery", [])} />
            <Muted>{bind("$device.status.batteryText", "--")}</Muted>
          </HStack>
        ) : (
          <Large>{bind("$device.clock", "--:--")}</Large>
        ))}
      </HStack>
      <Separator />
    </VStack>
  );
}

/** The content area between the status bar and the keys. */
export function Main({ children, ...layout }: LayoutProps & { children?: Children }): Element {
  return (
    <Stack gap={16} padding={[16, MARGIN]} width="fill" height="fill" {...layout}>
      {children}
    </Stack>
  );
}

const SIDE = Symbol("key side");
const TAB = 232;
type KeyProps = {
  children?: Content;
  side: "left" | "right";
  onPress: Handler;
  /** The expected key: ink. */
  primary?: boolean;
};
/** The label of a physical key: a tab on the bottom edge, its arrow pointing at the key. */
export function Key({ children, side, onPress, primary = false }: KeyProps): Element {
  const tab = (
    <Group width={TAB} height={SCREEN.height - TABS}>
      {/* Taller than the strip: the bottom corners fall off the panel, the tab meets the edge. */}
      {/* Centred in the 56 px that show (the bottom 16 px pad the hidden part): the arrow sits
          on the label's capitals, whatever the text box keeps above them for accents. */}
      <Surface variant={primary ? "ink" : "outline"} radius={16} width="fill" height={72} direction="row" align="center" gap={12} padding={[0, 22, 16, 22]}>
        <ArrowDownIcon size={24} />
        {inline(children, "leadStrong")}
      </Surface>
      <Pressable variant="ghost" input={side} width="fill" height="fill" label="" onPress={onPress} />
    </Group>
  );
  return Object.assign(tab, { [SIDE]: side });
}

/** Where the badge goes: the reader sits under the middle of the panel. */
export function ReaderHint({ children = "Badge" }: { children?: TextChildren }): Element {
  return (
    <VStack gap={4} align="center" padding={[2, 0, 0, 0]}>
      <NfcIcon size={28} />
      <Label align="center">{children}</Label>
    </VStack>
  );
}

/**
 * The two keys, each tab centred over its key (x 130 and 670), the reader hint between them.
 * A missing side keeps its place.
 */
export function Keys({ children, reader = false }: { children?: Children; reader?: boolean | TextChildren }): Element {
  const keys = [children].flat(Infinity as 1).filter(Boolean) as (Node & { [SIDE]?: string })[];
  const slot = (side: "left" | "right") => keys.find((k) => k[SIDE] === side) ?? <Group width={TAB} height={SCREEN.height - TABS} />;
  const inset = KEYS.left - TAB / 2;
  return (
    <HStack padding={[0, inset]} height={SCREEN.height - TABS} width="fill" align="start" justify="between">
      {slot("left")}
      {reader ? <ReaderHint>{reader === true ? undefined : reader}</ReaderHint> : null}
      {slot("right")}
    </HStack>
  );
}

/**
 * Run `onPress` when a badge is read. The host fires the `badge` input and puts the UID in
 * `$device.nfc.uid` first. Invisible; place it anywhere in the screen.
 */
export function BadgeInput({ onPress }: { onPress: Handler }): Element {
  return (
    <Overlay>
      <Pressable variant="ghost" input="badge" width={1} height={1} label="" onPress={onPress} />
    </Overlay>
  );
}

