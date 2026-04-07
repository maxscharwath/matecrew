import { AppSidebar } from "@/components/app-sidebar";
import { NavBreadcrumb } from "@/components/nav-breadcrumb";
import { EmailVerificationBanner } from "@/components/email-verification-banner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

interface OrgMembership {
  officeId: string;
  officeName: string;
}

interface SidebarShellProps {
  readonly children: React.ReactNode;
  readonly officeId: string;
  readonly isAdmin: boolean;
  readonly memberships: OrgMembership[];
  readonly avatarUrl?: string;
  readonly emailVerified?: boolean;
  readonly userEmail?: string;
}

export function SidebarShell({
  children,
  officeId,
  isAdmin,
  memberships,
  avatarUrl,
  emailVerified,
  userEmail,
}: SidebarShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar
        officeId={officeId}
        isAdmin={isAdmin}
        memberships={memberships}
        currentOfficeId={officeId}
        avatarUrl={avatarUrl}
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4!" />
          <NavBreadcrumb />
        </header>
        {!emailVerified && userEmail && (
          <EmailVerificationBanner email={userEmail} />
        )}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
