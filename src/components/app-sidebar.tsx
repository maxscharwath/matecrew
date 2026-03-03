"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const userNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/request", label: "Request", icon: "🧉" },
  { href: "/runner", label: "Runner", icon: "🏃" },
];

const adminNav: NavItem[] = [
  { href: "/admin/offices", label: "Offices", icon: "🏢" },
  { href: "/admin/stock", label: "Stock", icon: "📦" },
  { href: "/admin/purchases", label: "Purchases", icon: "🧾" },
  { href: "/admin/reimbursements", label: "Reimbursements", icon: "💰" },
];

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="text-lg font-semibold">
          MateCrew
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {userNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith(item.href)
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
        {isAdmin && (
          <>
            <div className="my-3 border-t" />
            <p className="px-3 text-xs font-medium uppercase text-muted-foreground">
              Admin
            </p>
            {adminNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
