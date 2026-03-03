"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Building2, Check, LogOut } from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import { switchUserLocale } from "@/lib/locale";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface OrgMembership {
  officeId: string;
  officeName: string;
}

interface UserMenuProps {
  readonly memberships: OrgMembership[];
  readonly currentOfficeId: string;
}

export function UserMenu({ memberships, currentOfficeId }: UserMenuProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();

  if (!session) return null;

  const currentOrg = memberships.find((m) => m.officeId === currentOfficeId);

  const initials = session.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col items-start">
          <span className="text-sm">{session.user.name}</span>
          {currentOrg && (
            <span className="text-xs text-muted-foreground">
              {currentOrg.officeName}
            </span>
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{session.user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('nav.switchOffice')}
        </DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.officeId}
            onClick={() => router.push(`/org/${m.officeId}/dashboard`)}
          >
            <Building2 className="mr-2 h-4 w-4" />
            {m.officeName}
            {m.officeId === currentOfficeId && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('auth.language')}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => { switchUserLocale(session.user.id, 'fr'); }}>
          Français {locale === 'fr' && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { switchUserLocale(session.user.id, 'en'); }}>
          English {locale === 'en' && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            router.push("/sign-in");
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
