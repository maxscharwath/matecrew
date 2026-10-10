/** @jsxImportSource ../runtime */
/**
 * Buttons and badges: the label is the children, icons included.
 *
 *   <Button onPress={take}><CupSodaIcon /> Prendre</Button>
 *   <Button variant="outline" size="sm" onPress={back}>Retour</Button>
 *   <Badge><WifiIcon size={18} /> Connecté</Badge>
 */
import { Button as Pressable, Group, type Content, type Handler } from "../runtime/jsx-runtime";
import type { Element } from "../runtime/types";
import type { Dimension } from "../runtime/layout";
import { Surface, type SurfaceVariant } from "./surface";
import { inline } from "./typography";

const SIZES = {
  sm: { height: 40, padding: 16, gap: 8, style: "captionStrong" },
  default: { height: 52, padding: 20, gap: 10, style: "strong" },
  lg: { height: 64, padding: 24, gap: 12, style: "leadStrong" },
} as const;
const VARIANTS: Record<"default" | "outline" | "secondary" | "ghost", SurfaceVariant> = {
  default: "ink",
  outline: "outline",
  secondary: "sunken",
  ghost: "ghost",
};

export type ButtonProps = {
  children?: Content;
  onPress: Handler;
  /** `default` (ink), `outline`, `secondary` (grey), `ghost` (text only). */
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** Hardware input that also presses it (`left`, `right`, `badge`). */
  input?: string;
  width?: Dimension;
};

/** A labelled control: what shows is a surface; a ghost hit area covers it. */
export function Button({ children, onPress, variant = "default", size = "default", input, width = "hug" }: Readonly<ButtonProps>): Element {
  const s = SIZES[size];
  return (
    <Group width={width} height={s.height}>
      <Surface
        variant={VARIANTS[variant]}
        radius={12}
        direction="row"
        align="center"
        justify="center"
        gap={s.gap}
        padding={[0, s.padding]}
        width={width === "hug" ? "hug" : "fill"}
        height="fill"
      >
        {inline(children, s.style)}
      </Surface>
      <Pressable variant="ghost" width="fill" height="fill" label="" onPress={onPress} {...(input ? { input } : {})} />
    </Group>
  );
}

/** A small pill: a status, a count, a warning. */
export function Badge({
  children,
  variant = "default",
}: Readonly<{
  children?: Content;
  /** `default` (ink), `outline`, `secondary` (grey). */
  variant?: "default" | "outline" | "secondary";
}>): Element {
  const look = { default: "ink", outline: "hairline", secondary: "tint" } as const;
  return (
    <Surface variant={look[variant]} radius={16} direction="row" align="center" gap={6} padding={[6, 12]}>
      {inline(children, "captionStrong")}
    </Surface>
  );
}
