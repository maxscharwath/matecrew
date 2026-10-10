/** @jsxImportSource ../runtime */
import { Card as Panel, Group, overlay, type Children } from "../runtime/jsx-runtime";
import type { Element } from "../runtime/types";
import type { Dimension, LayoutProps } from "../runtime/layout";
import { RADIUS, TONE } from "./tokens";

export type SurfaceVariant = "outline" | "hairline" | "sunken" | "tint" | "ink" | "paper" | "ghost";
const LOOK = {
  outline: { borderWidth: 2, background: "paper", opacity: 100 },
  hairline: { borderWidth: 1, background: "paper", opacity: 100 },
  sunken: { borderWidth: 0, background: "ink", opacity: TONE.faint },
  tint: { borderWidth: 0, background: "ink", opacity: TONE.light },
  ink: { borderWidth: 0, background: "ink", opacity: 100 },
  paper: { borderWidth: 0, background: "paper", opacity: 100 },
  ghost: { borderWidth: 0, background: "transparent", opacity: 100 },
} as const;

export type SurfaceProps = LayoutProps & {
  children?: Children;
  /**
   * `outline` (2 px) holds content, `hairline` groups quietly, `sunken` (12 %) and `tint` (25 %) are
   * dithered greys, `ink` turns its content to paper.
   */
  variant?: SurfaceVariant;
  radius?: number;
  width?: Dimension;
  height?: Dimension;
  x?: number;
  y?: number;
};

/** A box with a look: the base of cards, buttons, badges and keys. */
export function Surface({ variant = "outline", radius = RADIUS.card, children, ...props }: SurfaceProps): Element {
  return (
    <Panel {...props} radius={radius} {...LOOK[variant]}>
      {children}
    </Panel>
  );
}

/** A hairline rule across its parent, or down it (`vertical`). */
export function Separator({ vertical = false, dotted = false }: { vertical?: boolean; dotted?: boolean }): Element {
  const size = vertical ? { width: 1, height: "fill" as const } : { width: "fill" as const, height: 1 };
  return dotted ? (
    <Panel {...size} radius={0} borderWidth={1} borderStyle="dotted" background="transparent" />
  ) : (
    <Panel {...size} radius={0} borderWidth={0} background="ink" />
  );
}

/** A round frame for an icon, a product picture or a mark. */
export function Media({
  children,
  size = 96,
  variant = "sunken",
}: {
  children?: Children;
  size?: number;
  variant?: SurfaceVariant;
}): Element {
  return (
    <Surface variant={variant} radius={Math.floor(size / 2)} width={size} height={size} align="center" justify="center">
      {children}
    </Surface>
  );
}

/** Content drawn over the screen, out of its flow (toasts, dialogs, badges in a corner). */
export function Overlay({ children }: { children?: Children }): Element {
  return overlay(Group({ width: "fill", height: "fill", children }));
}
