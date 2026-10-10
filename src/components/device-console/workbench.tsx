import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * How both consoles lay a terminal out, on the room the page leaves (the sidebar takes some): the
 * terminal itself, its rail (status, memory, actions) beside it once the panel still gets about
 * 700 px there, else under it; the log under the terminal.
 */
export function Workbench({ terminal, rail, logs }: Readonly<{ terminal: ReactNode; rail: ReactNode; logs: ReactNode }>) {
  return (
    <div className="@container">
      <div className="grid gap-6 @min-[66rem]:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">{terminal}</div>
        <aside className="grid content-start gap-4 @2xl:grid-cols-2 @min-[66rem]:row-span-2 @min-[66rem]:grid-cols-1">
          {rail}
        </aside>
        <div className="min-w-0">{logs}</div>
      </div>
    </div>
  );
}

/** A section of the rail: a small title, an optional line under it or an action beside it. */
export function RailCard({
  icon,
  title,
  description,
  action,
  children,
  className,
}: Readonly<{
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm", className)}>
      <header className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
            {icon}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export type Fact = {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  mono?: boolean;
  muted?: boolean;
  alert?: boolean;
};

/** Label on the left, value on the right, a muted line under the value when there is one. */
export function FactList({ facts }: Readonly<{ facts: readonly Fact[] }>) {
  return (
    <dl className="divide-y text-sm">
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <dt className="flex shrink-0 items-center gap-2 text-muted-foreground [&_svg]:size-3.5">
            {fact.icon}
            {fact.label}
          </dt>
          <dd className="min-w-0 text-right" suppressHydrationWarning>
            <div
              className={cn(
                "truncate font-medium",
                fact.mono && "font-mono text-xs leading-5",
                fact.muted && "font-normal text-muted-foreground",
                fact.alert && "text-destructive",
              )}
            >
              {fact.value}
            </div>
            {fact.detail && <div className="text-xs text-pretty text-muted-foreground">{fact.detail}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
