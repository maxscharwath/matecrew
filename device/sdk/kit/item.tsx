/** @jsxImportSource ../runtime */
/**
 * List rows, as shadcn's Item:
 *
 *   <Item onPress={open}>
 *     <ItemMedia><WifiIcon /></ItemMedia>
 *     <ItemContent><ItemTitle>Wi-Fi</ItemTitle><ItemDescription>OWT-Office</ItemDescription></ItemContent>
 *     <ItemActions><ChevronRightIcon /></ItemActions>
 *   </Item>
 */
import { Button as Pressable, Group, HStack, VStack, type Children, type Handler, type TextChildren } from "../runtime/jsx-runtime";
import type { Element } from "../runtime/types";
import { Surface, type SurfaceVariant } from "./surface";
import { Large, Lead, Muted } from "./typography";

export function Item({
  children,
  onPress,
  input,
  variant,
}: {
  children?: Children;
  /** Makes the whole row pressable. */
  onPress?: Handler;
  input?: string;
  /** A boxed row (`outline`, `sunken`…); plain by default. */
  variant?: SurfaceVariant;
}): Element {
  const row = variant ? (
    <Surface variant={variant} direction="row" align="center" gap={16} padding={[12, 16]} width="fill">
      {children}
    </Surface>
  ) : (
    <HStack align="center" gap={16} padding={[8, 0]} width="fill">
      {children}
    </HStack>
  );
  if (!onPress) return row;
  return (
    <Group width="fill">
      {row}
      <Pressable variant="ghost" width="fill" height="fill" label="" onPress={onPress} {...(input ? { input } : {})} />
    </Group>
  );
}
/** A lone child needs no wrapper: keep node counts low on the device. */
const lone = (children: Children, wrap: () => Element): Element => {
  const nodes = [children].flat(Infinity as 1).filter(Boolean) as Element[];
  return nodes.length === 1 ? nodes[0] : wrap();
};
export const ItemMedia = ({ children }: { children?: Children }): Element =>
  lone(children, () => <HStack align="center">{children}</HStack>);
export const ItemContent = ({ children }: { children?: Children }): Element => (
  <VStack gap={2} width="fill">{children}</VStack>
);
export const ItemTitle = ({ children }: { children?: TextChildren }): Element => <Lead lines={1}>{children}</Lead>;
export const ItemDescription = ({ children }: { children?: TextChildren }): Element => <Muted lines={1}>{children}</Muted>;
export const ItemActions = ({ children }: { children?: Children }): Element =>
  lone(children, () => <HStack gap={12} align="center">{children}</HStack>);
/** A strong one-line title, when the row is a value rather than a link. */
export const ItemValue = ({ children }: { children?: TextChildren }): Element => <Large align="right">{children}</Large>;
