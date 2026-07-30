"use client";

import { useLocale, useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  itemSlots,
  slotColor,
  useChartTheme,
  type ItemDatum,
} from "@/components/stats/chart-kit";
import { cn } from "@/lib/utils";

interface PreferenceUser {
  userId: string;
  name: string;
  image?: string;
  qty: number;
  qtyByItem: Record<string, number>;
}

interface PreferencesListProps {
  /** Office-wide item ranking — drives the shared color slots and legend. */
  readonly items: ItemDatum[];
  readonly users: PreferenceUser[];
  readonly meId: string;
  readonly otherLabel: string;
  readonly cansUnit: string;
}

/**
 * Taste profile per member: each row is a 100%-stacked share bar, so a light
 * drinker's preference is as readable as a heavy one's. Colors are the same
 * item slots as the ring above, and the row's biggest slice is named outright
 * — the bar shows the mix, the label answers "what do they drink?".
 */
export function PreferencesList({
  items,
  users,
  meId,
  otherLabel,
  cansUnit,
}: PreferencesListProps) {
  const theme = useChartTheme();
  const locale = useLocale();
  // Parameterized label — can't cross the server/client boundary as a prop.
  const t = useTranslations("stats");

  const slots = itemSlots(items, otherLabel);
  const colors = slots.map((slot, i) => slotColor(theme, slot, i));

  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {slots.map((slot, i) => (
          <li
            key={slot.key}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: colors[i] }}
              aria-hidden
            />
            {slot.name}
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        {users.map((u) => {
          const shares = slots.map((slot) =>
            slot.itemIds.reduce((sum, id) => sum + (u.qtyByItem[id] ?? 0), 0),
          );
          const total = shares.reduce((sum, q) => sum + q, 0);
          const topIndex = shares.reduce(
            (best, q, i) => (q > shares[best] ? i : best),
            0,
          );

          return (
            <div
              key={u.userId}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-1.5",
                u.userId === meId && "bg-accent/60",
              )}
            >
              <Avatar size="sm">
                <AvatarImage src={u.image} alt={u.name} />
                <AvatarFallback>
                  {u.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{u.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {total > 0
                      ? t("favoriteShare", {
                          item: slots[topIndex].name,
                          share: Math.round((shares[topIndex] / total) * 100),
                        })
                      : "—"}
                  </span>
                </div>
                <div
                  className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={slots
                    .map((slot, i) =>
                      shares[i] > 0
                        ? `${slot.name}: ${shares[i]} ${cansUnit}`
                        : null,
                    )
                    .filter(Boolean)
                    .join(", ")}
                >
                  {slots.map((slot, i) =>
                    shares[i] > 0 ? (
                      <span
                        key={slot.key}
                        title={`${slot.name} · ${shares[i].toLocaleString(locale)} ${cansUnit}`}
                        style={{
                          width: `${(shares[i] / total) * 100}%`,
                          backgroundColor: colors[i],
                        }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
              <div className="w-12 shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {u.qty.toLocaleString(locale)}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {cansUnit}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
