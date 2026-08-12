import { AppSidebar } from "@/components/app-sidebar";
import { NavBreadcrumb } from "@/components/nav-breadcrumb";
import { EmailVerificationBanner } from "@/components/email-verification-banner";
import { UnpaidInvoicesBanner } from "@/components/unpaid-invoices-banner";
import { WhatsNewAnnouncer } from "@/components/whats-new/whats-new-announcer";
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
  readonly userId: string;
  readonly unreadWhatsNew?: number;
}

export function SidebarShell({
  children,
  officeId,
  isAdmin,
  memberships,
  avatarUrl,
  emailVerified,
  userEmail,
  userId,
  unreadWhatsNew,
}: SidebarShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar
        officeId={officeId}
        isAdmin={isAdmin}
        memberships={memberships}
        currentOfficeId={officeId}
        avatarUrl={avatarUrl}
        unreadWhatsNew={unreadWhatsNew}
      />
      <SidebarInset>
        {/* SidebarInset sets no height, so the document is what scrolls — the
            banners have to be pinned along with the header or they scroll away.
            One sticky wrapper keeps them stacked without juggling top offsets. */}
        <div className="sticky top-0 z-20">
          {!emailVerified && userEmail && (
            <EmailVerificationBanner email={userEmail} />
          )}
          <UnpaidInvoicesBanner userId={userId} />
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4!" />
            <NavBreadcrumb />
          </header>
        </div>

        {/* Faint herbal wash so the content area is not flat white. */}
        <main className="brand-wash flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
        {/* Renders nothing unless there are unread release notes, so it can sit
            on every signed-in page. */}
        <WhatsNewAnnouncer />
      </SidebarInset>
    </SidebarProvider>
  );
}
