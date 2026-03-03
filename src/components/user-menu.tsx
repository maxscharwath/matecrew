"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Check, LogOut, User } from "lucide-react";
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

interface OrgMembership {
  officeId: string;
  officeName: string;
}

interface UserMenuProps {
  readonly memberships: OrgMembership[];
  readonly currentOfficeId: string;
  readonly avatarUrl?: string;
}

export function UserMenu({ memberships, currentOfficeId, avatarUrl }: UserMenuProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const t = useTranslations();

  if (!session) return null;

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
          <AvatarImage src={avatarUrl} alt={session.user.name} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <span className="text-sm">{session.user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
          {session.user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <User className="mr-2 h-4 w-4" />
          {t("profile.title")}
        </DropdownMenuItem>
        {memberships.length > 1 && (
          <>
            <DropdownMenuSeparator />
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
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            router.push("/sign-in");
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
