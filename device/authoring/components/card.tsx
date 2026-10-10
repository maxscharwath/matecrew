/** @jsxImportSource .. */
import { Column, Group, Text } from "../jsx-runtime";
import type { Element } from "../types";

type Content = Element | Content[] | null | undefined | false;
type SectionProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  children?: Content;
};
/** Compose inside a Card/Column. Geometry stays explicit and deterministic on small displays. */
export function CardHeader(props: SectionProps & { gap?: number }): Element {
  return <Column {...props} gap={2 * (props.gap ?? 1)} />;
}
export function CardContent(props: SectionProps): Element {
  return <Group {...props} />;
}
export function CardFooter(props: SectionProps): Element {
  return <Group {...props} />;
}
type LabelProps = {
  value: unknown;
  width: number;
  x?: number;
  y?: number;
  height?: number;
};
export function CardTitle(props: LabelProps): Element {
  return <Text {...props} height={2 * (props.height ?? 15)} font="title" />;
}
export function CardDescription(props: LabelProps): Element {
  return <Text {...props} height={2 * (props.height ?? 12)} font="caption" />;
}
