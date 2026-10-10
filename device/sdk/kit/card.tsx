/** @jsxImportSource ../runtime */
/**
 * Cards, as shadcn composes them:
 *
 *   <Card>
 *     <CardHeader>
 *       <CardTitle>Stock</CardTitle>
 *       <CardDescription>7 derniers jours</CardDescription>
 *     </CardHeader>
 *     <CardContent>…</CardContent>
 *     <CardFooter>…</CardFooter>
 *   </Card>
 */
import { HStack, VStack, type Children, type TextChildren } from "../runtime/jsx-runtime";
import type { Element } from "../runtime/types";
import type { Dimension, LayoutProps } from "../runtime/layout";
import { Surface, type SurfaceVariant } from "./surface";
import { H3, Muted } from "./typography";

export function Card({
  children,
  variant = "outline",
  width = "fill",
  height = "hug",
  ...layout
}: LayoutProps & { children?: Children; variant?: SurfaceVariant; width?: Dimension; height?: Dimension }): Element {
  return (
    <Surface variant={variant} width={width} height={height} gap={16} padding={24} {...layout}>
      {children}
    </Surface>
  );
}
export const CardHeader = ({ children }: { children?: Children }): Element => <VStack gap={6}>{children}</VStack>;
export const CardTitle = ({ children }: { children?: TextChildren }): Element => <H3>{children}</H3>;
export const CardDescription = ({ children }: { children?: TextChildren }): Element => <Muted>{children}</Muted>;
export const CardContent = ({ children, ...layout }: LayoutProps & { children?: Children }): Element => (
  <VStack gap={12} {...layout} height="fill">
    {children}
  </VStack>
);
export const CardFooter = ({ children, ...layout }: LayoutProps & { children?: Children }): Element => (
  <HStack gap={12} {...layout}>
    {children}
  </HStack>
);
