import { cn } from "@/lib/utils";

interface SignedMoneyProps {
  /** Positive is a cost, negative a credit. */
  readonly value: number;
  readonly className?: string;
}

/**
 * A signed amount in francs, coloured like `SignedQty` is for cans: red when it
 * costs, green when it comes back. Zero renders as a dash — a settled line has
 * nothing to say.
 */
export function SignedMoney({ value, className }: SignedMoneyProps) {
  if (value === 0) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  return (
    <span
      className={cn(
        "tabular-nums",
        value > 0
          ? "text-red-600 dark:text-red-400"
          : "text-green-600 dark:text-green-400",
        className,
      )}
    >
      CHF {Math.abs(value).toFixed(2)}
    </span>
  );
}
