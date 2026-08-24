"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all__";

interface StockUserFilterProps {
  readonly users: readonly { readonly id: string; readonly name: string }[];
  readonly userId?: string;
}

/**
 * Narrows the audit log to a single user. Lives in the URL (`?user=`) so the
 * server re-queries and the view stays shareable; changing it drops `page`
 * because the filtered log has its own, shorter pagination.
 */
export function StockUserFilter({ users, userId }: StockUserFilterProps) {
  const t = useTranslations("stock");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === ALL) params.delete("user");
    else params.set("user", next);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <Select value={userId ?? ALL} onValueChange={select}>
      <SelectTrigger
        size="sm"
        aria-label={t("filterByUser")}
        className={cn("w-[13rem] transition-opacity", pending && "opacity-60")}
      >
        <Users className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("allUsers")}</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
