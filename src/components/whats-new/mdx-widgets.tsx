import { Info, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Meter,
  SplitBar,
  StatTiles,
  Terminal,
  TrendChart,
} from "@/components/whats-new/charts";

/**
 * Components articles may use in their MDX body.
 *
 * This is what MDX buys over plain markdown: a release note can show a real UI
 * fragment instead of a screenshot that goes stale the moment the design moves.
 * Keep them presentational — an article must never need props from a page.
 */

/** A highlighted aside for caveats and policy notes. */
export function Callout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-dashed p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="[&>p:last-child]:mb-0">{children}</div>
    </div>
  );
}

/** Sample prompts, rendered as chat-style lines. */
export function TryIt({ examples }: { readonly examples: readonly string[] }) {
  return (
    <div className="mb-4 space-y-2 rounded-md bg-muted p-3">
      {examples.map((example) => (
        <p key={example} className="flex items-start gap-2 text-sm">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="italic">&ldquo;{example}&rdquo;</span>
        </p>
      ))}
    </div>
  );
}

/** A labelled before/after or feature comparison, without needing a table. */
export function Compare({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  readonly before: string;
  readonly after: string;
  readonly beforeLabel: string;
  readonly afterLabel: string;
}) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      {[
        { label: beforeLabel, value: before, muted: true },
        { label: afterLabel, value: after, muted: false },
      ].map((side) => (
        <div key={side.label} className="rounded-md border p-3">
          <Badge variant={side.muted ? "secondary" : "default"} className="mb-2">
            {side.label}
          </Badge>
          <p className="text-sm text-muted-foreground">{side.value}</p>
        </div>
      ))}
    </div>
  );
}

/** A short list of what shipped, as ticked items. */
export function Highlights({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="mb-4 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm">
          <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
            &#10003;
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Everything an article body may reference, passed in at render time. */
export const articleComponents = {
  Callout,
  TryIt,
  Compare,
  Highlights,
  BarChart,
  TrendChart,
  SplitBar,
  StatTiles,
  Meter,
  Terminal,
};
