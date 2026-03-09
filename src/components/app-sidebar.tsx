"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronsUpDown,
  ClipboardList,
  CupSoda,
  HandCoins,
  LogOut,
  Package,
  PersonStanding,
  Plus,
  Receipt,
  Settings,
  Timer,
  User,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface OrgMembership {
  officeId: string;
  officeName: string;
}

interface AppSidebarProps {
  officeId: string;
  isAdmin: boolean;
  memberships: OrgMembership[];
  currentOfficeId: string;
  avatarUrl?: string;
}

export function AppSidebar({
  officeId,
  isAdmin,
  memberships,
  currentOfficeId,
  avatarUrl,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations();
  const { data: session } = useSession();
  const { setOpenMobile, isMobile } = useSidebar();

  const userNav: NavItem[] = [
    { path: "/dashboard", label: t("nav.dashboard"), icon: BarChart3 },
    { path: "/request", label: t("nav.request"), icon: CupSoda },
    { path: "/runner", label: t("nav.runner"), icon: PersonStanding },
    { path: "/reimbursements", label: t("nav.reimbursements"), icon: Wallet },
  ];

  const adminNav: NavItem[] = [
    { path: "/admin/members", label: t("nav.members"), icon: Users },
    { path: "/admin/schedule", label: t("nav.schedule"), icon: CalendarDays },
    { path: "/admin/cron", label: t("nav.cronJobs"), icon: Timer },
    { path: "/admin/stock", label: t("nav.stock"), icon: Package },
    { path: "/admin/consumption", label: t("nav.consumption"), icon: ClipboardList },
    { path: "/admin/purchases", label: t("nav.purchases"), icon: Receipt },
    {
      path: "/admin/reimbursements",
      label: t("nav.settlements"),
      icon: HandCoins,
    },
    { path: "/admin/settings", label: t("nav.settings"), icon: Settings },
  ];

  const prefix = `/org/${officeId}`;

  const initials = session?.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={`${prefix}/dashboard`}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <CupSoda className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">MateCrew</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {memberships.find((m) => m.officeId === currentOfficeId)
                      ?.officeName ?? ""}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {userNav.map((item) => {
                const href = `${prefix}${item.path}`;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(href)}
                      onClick={() => setOpenMobile(false)}
                    >
                      <Link href={href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("common.admin")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNav.map((item) => {
                  const href = `${prefix}${item.path}`;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname.startsWith(href)}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Link href={href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarImage
                      src={avatarUrl}
                      alt={session?.user.name ?? ""}
                    />
                    <AvatarFallback className="rounded-lg text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {session?.user.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {session?.user.email}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarImage
                        src={avatarUrl}
                        alt={session?.user.name ?? ""}
                      />
                      <AvatarFallback className="rounded-lg text-xs">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">
                        {session?.user.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {session?.user.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/profile")}>
                  <User className="mr-2 size-4" />
                  {t("profile.title")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {memberships.map((m) => (
                  <DropdownMenuItem
                    key={m.officeId}
                    onClick={() =>
                      router.push(`/org/${m.officeId}/dashboard`)
                    }
                  >
                    <Building2 className="mr-2 size-4" />
                    {m.officeName}
                    {m.officeId === currentOfficeId && (
                      <Check className="ml-auto size-4" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => router.push("/org/create")}>
                  <Plus className="mr-2 size-4" />
                  {t("office.createOffice")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await signOut();
                    router.push("/sign-in");
                  }}
                >
                  <LogOut className="mr-2 size-4" />
                  {t("auth.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
