/** @jsxImportSource ../runtime */
/**
 * Typography as components, like shadcn's: the text is the children, the component is the style.
 *
 *   <H2>Pose ton badge</H2>
 *   <Muted>Sur le lecteur, sous l'écran</Muted>
 *   <Num size="xl">{stock}</Num>
 */
import { Text, textOf, type Content, type TextChildren } from "../runtime/jsx-runtime";
import type { Binding, Element, Node, Typography } from "../runtime/types";
import type { Dimension } from "../runtime/layout";
import { upper } from "../runtime/expr";
import { TYPE, type TypeName, type TypeStyle } from "./tokens";

const METRICS = new Set(["ascent", "cap", "line"]);
/** A style without the metrics the kit places it by: what the engine's text takes. */
const typographyOf = (style: TypeStyle) => Object.fromEntries(Object.entries(style).filter(([key]) => !METRICS.has(key))) as Typography;

export type TextProps = {
  children?: TextChildren;
  align?: "left" | "center" | "right";
  /** Lines before the text ellipsizes (default 1; headings 2). */
  lines?: number;
  width?: Dimension;
  /** Rarely needed: ink surfaces already turn their content to paper. */
  inverted?: boolean;
  /** Too long for its box: smaller sizes of its family before an ellipsis. */
  fit?: boolean;
};

/** Text in one of the kit's styles. */
export function Styled({ style, children, align = "left", lines = 1, width, inverted, fit, value }: TextProps & { style: TypeName; value?: Binding }) {
  const typography = { ...typographyOf(TYPE[style]), ...(fit ? { fit } : {}) };
  return (
    <Text
      {...typography}
      value={value ?? textOf(children ?? "")}
      align={align}
      maxLines={lines}
      width={width}
      inverted={inverted}
    />
  );
}
const styled = (style: TypeName, defaultLines = 1) => (props: TextProps) => <Styled style={style} lines={defaultLines} {...props} />;

/** Display title, 42 px bold. */
export const H1 = styled("display", 2);
/** Screen title, 30 px bold. */
export const H2 = styled("headline", 2);
/** Section or card title, 25 px bold. */
export const H3 = styled("title", 2);
/** Small title, 20 px bold. */
export const H4 = styled("leadStrong");
/** A sentence that introduces, 20 px. */
export const Lead = styled("lead", 3);
/** Body text, 17 px. */
export const P = styled("body", 4);
/** Emphasised body, 17 px bold. */
export const Large = styled("strong", 2);
/** Small and bold, 14 px. */
export const Small = styled("captionStrong");
/** Secondary detail, 14 px. */
export const Muted = styled("caption", 2);
/** Fine print, 11 px: a build stamp, a footnote. */
export const Footnote = styled("footnote", 2);

/** Spaced capitals above a value or a section; the text is capitalised for you. */
export function Label(props: TextProps) {
  const text = textOf(props.children ?? "");
  const value = "literal" in text ? { literal: String(text.literal ?? "").toUpperCase() } : upper(text);
  return <Styled style="label" {...props} value={value} />;
}

const FIGURES = { xs: "figureXS", sm: "figureS", md: "figure", lg: "figureL", xl: "figureXL", "2xl": "figureXXL" } as const;
/** A number to read from across the room (Logisoso). `lg` and up hold digits and `+ - . , : /`. */
export function Num({ size = "md", ...props }: TextProps & { size?: keyof typeof FIGURES }) {
  return <Styled style={FIGURES[size]} {...props} />;
}

/**
 * Children that mix text and elements (`<WifiIcon /> Connecter`): each run of text becomes one
 * text node in `style`, trimmed at the edges (the layout's gap spaces them).
 */
export function inline(children: Content, style: TypeName, align: "left" | "center" = "left"): Node[] {
  const out: Node[] = [];
  let run: TextChildren[] = [];
  const flush = () => {
    if (!run.length) return;
    const parts = run.map((part, i) =>
      typeof part === "string" ? (i === 0 ? part.trimStart() : i === run.length - 1 ? part.trimEnd() : part) : part,
    );
    run = [];
    const text = textOf(parts);
    if ("literal" in text && !String(text.literal ?? "")) return;
    out.push(Styled({ style, value: text, align }) as Node);
  };
  const walk = (child: unknown): void => {
    if (child === null || child === undefined || child === false || child === true) return;
    if (Array.isArray(child)) return child.forEach(walk);
    if (typeof child === "object" && "kind" in (child as object) && !("bind" in (child as object))) {
      flush();
      out.push(child as Node);
      return;
    }
    run.push(child as TextChildren);
  };
  walk(children);
  flush();
  return out;
}
export type { Element };
