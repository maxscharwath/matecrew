"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boxes, ChevronDown, Tags, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ICONS = { user: Users, item: Boxes, source: Tags };

interface TableFilterProps {
  readonly options: readonly { readonly id: string; readonly name: string }[];
  /** Currently checked ids, straight from the URL. */
  readonly selected: readonly string[];
  /** Query parameter this filter owns, e.g. "user" or "item". */
  readonly param: string;
  /** Accessible name for the control, e.g. "Filter by user". */
  readonly label: string;
  /** Shown on the trigger while nothing is checked, e.g. "All users". */
  readonly allLabel: string;
  readonly icon: keyof typeof ICONS;
}

/**
 * Multi-select filter for a paginated table: check any number of people or
 * items and the list narrows to their union.
 *
 * The checked ids live in the URL as repeated params (`?user=a&user=b`) so the
 * server re-queries and the view stays shareable — there is no local copy to
 * drift. Toggling drops `page`, because the narrowed list has its own, shorter
 * pagination.
 */
export function TableFilter({
  options,
  selected,
  param,
  label,
  allLabel,
  icon,
}: TableFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const Icon = ICONS[icon];

  function apply(ids: readonly string[]) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(param);
    for (const id of ids) params.append(param, id);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function toggle(id: string) {
    apply(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );
  }

  const checkedNames = options
    .filter((o) => selected.includes(o.id))
    .map((o) => o.name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          className={cn(
            "max-w-[16rem] justify-between gap-2 font-normal transition-opacity",
            pending && "opacity-60",
          )}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {checkedNames.length === 0 ? allLabel : checkedNames.join(", ")}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuItem
          disabled={selected.length === 0}
          onSelect={() => apply([])}
        >
          {allLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={selected.includes(o.id)}
            // Keep the menu open so several boxes can be ticked in one go.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o.id)}
          >
            {/* The menu item only draws a tick once checked; this sits under it
                so an unticked row still reads as an empty box. */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-2 size-4 rounded-[4px] border border-input"
            />
            {o.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
