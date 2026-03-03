"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  CalendarDays,
  CupSoda,
  PersonStanding,
  Settings,
  Package,
  Receipt,
  Wallet,
  HandCoins,
  Timer,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface AppSidebarProps {
  officeId: string;
  isAdmin: boolean;
}

export function AppSidebar({ officeId, isAdmin }: AppSidebarProps) {
  const pathname = usePathname();
  const t = useTranslations();

  const userNav: NavItem[] = [
    { path: "/dashboard", label: t('nav.dashboard'), icon: BarChart3 },
    { path: "/request", label: t('nav.request'), icon: CupSoda },
    { path: "/runner", label: t('nav.runner'), icon: PersonStanding },
    { path: "/reimbursements", label: t('nav.reimbursements'), icon: Wallet },
  ];

  const adminNav: NavItem[] = [
    { path: "/admin/members", label: t('nav.members'), icon: Users },
    { path: "/admin/schedule", label: t('nav.schedule'), icon: CalendarDays },
    { path: "/admin/cron", label: t('nav.cronJobs'), icon: Timer },
    { path: "/admin/settings", label: t('nav.settings'), icon: Settings },
    { path: "/admin/stock", label: t('nav.stock'), icon: Package },
    { path: "/admin/purchases", label: t('nav.purchases'), icon: Receipt },
    { path: "/admin/reimbursements", label: t('nav.settlements'), icon: HandCoins },
  ];
  const prefix = `/org/${officeId}`;

  function renderLink(item: NavItem) {
    const href = `${prefix}${item.path}`;
    return (
      <Link
        key={item.path}
        href={href}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          pathname.startsWith(href)
            ? "bg-accent font-medium text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <item.icon className="size-4" />
        {item.label}
      </Link>
    );
  }

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link href={`${prefix}/dashboard`} className="text-lg font-semibold">
          MateCrew
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {userNav.map(renderLink)}
        {isAdmin && (
          <>
            <div className="my-3 border-t" />
            <p className="px-3 text-xs font-medium uppercase text-muted-foreground">
              {t('common.admin')}
            </p>
            {adminNav.map(renderLink)}
          </>
        )}
      </nav>
    </aside>
  );
}
