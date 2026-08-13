import { cn } from "@/lib/utils";

interface SignedQtyProps {
  /** Positive gains, negative losses. Null renders a dash. */
  readonly value: number | null;
  readonly className?: string;
}

/**
 * A signed quantity of cans: green when the fridge gained, red when it lost.
 *
 * Stock deltas are shown in three places (audit log, count sheet, count
 * history) and the colours have to mean the same thing in all of them, so the
 * sign convention lives here rather than in each table.
 */
export function SignedQty({ value, className }: SignedQtyProps) {
  if (value == null) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  return (
    <span
      className={cn(
        "tabular-nums",
        value === 0
          ? "text-muted-foreground"
          : value > 0
            ? "text-green-600 dark:text-green-400"
            : "text-red-600 dark:text-red-400",
        className,
      )}
    >
      {value > 0 ? `+${value}` : value}
    </span>
  );
}
