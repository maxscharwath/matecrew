/** @jsxImportSource ../runtime */
/**
 * Messages and states: alerts, empty states, progress, steps and stats.
 *
 *   <Alert><TriangleAlertIcon /><AlertTitle>Wi-Fi introuvable</AlertTitle><AlertDescription>…</AlertDescription></Alert>
 *   <Empty><EmptyMedia><PackageOpenIcon /></EmptyMedia><EmptyTitle>Aucun article</EmptyTitle></Empty>
 *   <Stat><StatLabel>En stock</StatLabel><StatValue size="2xl">{stock}</StatValue></Stat>
 */
import { HStack, Progress as Bar, VStack, type Children, type TextChildren } from "../runtime/jsx-runtime";
import type { Element, Node } from "../runtime/types";
import type { Dimension } from "../runtime/layout";
import { CheckIcon } from "../icons/lucide";
import { Media, Surface, type SurfaceVariant } from "./surface";
import { H2, H3, Label, Lead, Muted, Num, P, Small } from "./typography";

const isImage = (node: Node) => node.kind === "image";

/** A boxed message: its icons on the left, title and description on the right. */
export function Alert({ children, variant = "sunken" }: { children?: Children; variant?: SurfaceVariant }): Element {
  const nodes = [children].flat(Infinity as 1).filter(Boolean) as Node[];
  return (
    <Surface variant={variant} direction="row" gap={16} padding={20} width="fill" align="center">
      {nodes.filter(isImage)}
      <VStack gap={4} width="fill">
        {nodes.filter((n) => !isImage(n))}
      </VStack>
    </Surface>
  );
}
export const AlertTitle = ({ children }: { children?: TextChildren }): Element => <H3 lines={1}>{children}</H3>;
export const AlertDescription = ({ children }: { children?: TextChildren }): Element => <P lines={3}>{children}</P>;

/** A centred state: nothing yet, done, or a step in progress. */
export function Empty({ children }: { children?: Children }): Element {
  return (
    <VStack gap={16} align="center" justify="center" width="fill" height="fill">
      {children}
    </VStack>
  );
}
export const EmptyMedia = ({ children, variant = "sunken", size = 112 }: { children?: Children; variant?: SurfaceVariant; size?: number }): Element => (
  <Media variant={variant} size={size}>{children}</Media>
);
export const EmptyTitle = ({ children }: { children?: TextChildren }): Element => <H2 align="center">{children}</H2>;
export const EmptyDescription = ({ children }: { children?: TextChildren }): Element => <Lead align="center" lines={2}>{children}</Lead>;
export const EmptyContent = ({ children }: { children?: Children }): Element => (
  <VStack gap={12} align="center">{children}</VStack>
);

/** A pill progress bar over the full width (0–100). */
export function Progress({ value, height = 24, width = "fill" }: { value: unknown; height?: number; width?: Dimension }): Element {
  return <Bar value={value} width={width} height={height} />;
}

/** A number with its label and a line of help. */
export function Stat({ children, align = "start" }: { children?: Children; align?: "start" | "center" | "end" }): Element {
  return <VStack gap={6} align={align}>{children}</VStack>;
}
/** Tiles are narrow: label and value shrink before they would cut. */
export const StatLabel = ({ children }: { children?: TextChildren }): Element => <Label fit>{children}</Label>;
export const StatValue = ({ children, size = "lg" }: { children?: TextChildren; size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" }): Element => (
  <Num size={size} fit>{children}</Num>
);
export const StatHelp = ({ children }: { children?: TextChildren }): Element => <Muted>{children}</Muted>;

/**
 * Where someone is in a sequence: done steps are ink discs with a check, the current one a ring
 * with its number, the rest hairline.
 */
export function Steps({ steps, current }: { steps: TextChildren[]; current: number }): Element {
  return (
    <HStack gap={12}>
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <HStack gap={8}>
            {i > 0 && <Surface variant={i <= current ? "ink" : "tint"} radius={1} width={12} height={2} />}
            <Surface variant={done ? "ink" : now ? "outline" : "hairline"} radius={12} width={24} height={24} align="center" justify="center">
              {done ? <CheckIcon size={16} strokeWidth={2.5} /> : <Small align="center">{String(i + 1)}</Small>}
            </Surface>
            {now || done ? <Small>{label}</Small> : <Muted lines={1}>{label}</Muted>}
          </HStack>
        );
      })}
    </HStack>
  );
}

