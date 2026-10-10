/**
 * The kit: shadcn-style components for the 800 × 480 panel, laid out by the engine's flex.
 * Content goes in children; props pick a variant or a size.
 */
export type { IconProps, IconComponent } from "../icons/factory";
export { createArt, createVectorIcon } from "../icons/factory";
export * from "./tokens";
export { H1, H2, H3, H4, Lead, P, Large, Small, Muted, Footnote, Label, Num, Styled, inline, type TextProps } from "./typography";
export { Surface, Separator, Media, Overlay, type SurfaceVariant, type SurfaceProps } from "./surface";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";
export { Button, Badge, type ButtonProps } from "./button";
export {
  Alert,
  AlertTitle,
  AlertDescription,
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  Progress,
  Stat,
  StatLabel,
  StatValue,
  StatHelp,
  Steps,
} from "./feedback";
export { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemValue } from "./item";
export { StatusBar, Main, Keys, Key, ReaderHint, BadgeInput } from "./device";
export { QrCode } from "./qr";
export { OverlayHost } from "./overlays";
export { MateCrewMark, OwtMark, OwtLogo, Logo } from "./brand";
export {
  LineChart,
  BarChart,
  AreaChart,
  ComposedChart,
  Line,
  Bar,
  Area,
  Spark,
} from "./charts";
export type { ChartProps } from "./charts";
