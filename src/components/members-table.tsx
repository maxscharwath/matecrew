"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { MoreHorizontal, ShieldCheck, Trash2, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  updateMemberRoles,
  removeMember,
} from "@/app/org/[officeId]/admin/members/actions";

type Role = "ADMIN" | "USER";

interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  roles: Role[];
}

interface MembersTableProps {
  readonly officeId: string;
  readonly members: MemberRow[];
  readonly currentUserId: string;
}

const ALL_ROLES: Role[] = ["ADMIN", "USER"];

const ROLE_CONFIG: Record<Role, { variant: "default" | "secondary"; icon: typeof ShieldCheck }> = {
  ADMIN: { variant: "default", icon: ShieldCheck },
  USER: { variant: "secondary", icon: User },
};

export function MembersTable({
  officeId,
  members,
  currentUserId,
}: MembersTableProps) {
  const [isPending, startTransition] = useTransition();
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const t = useTranslations();

  const adminCount = members.filter((m) =>
    m.roles.includes("ADMIN")
  ).length;

  function handleRoleToggle(member: MemberRow, role: Role) {
    const hasRole = member.roles.includes(role);
    const newRoles = hasRole
      ? member.roles.filter((r) => r !== role)
      : [...member.roles, role];

    if (newRoles.length === 0) return;

    startTransition(async () => {
      const result = await updateMemberRoles(
        officeId,
        member.membershipId,
        newRoles
      );
      if (result.success) {
        toast.success(t("members.rolesUpdated"));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRemove() {
    if (!removeTarget) return;
    startTransition(async () => {
      const result = await removeMember(officeId, removeTarget.membershipId);
      if (result.success) {
        toast.success(t("members.memberRemoved"));
      } else {
        toast.error(result.error);
      }
      setRemoveTarget(null);
    });
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("members.noMembers")}
      </p>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("members.name")}</TableHead>
              <TableHead>{t("members.email")}</TableHead>
              <TableHead>{t("members.roles")}</TableHead>
              <TableHead className="w-[80px]">{t("members.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isLastAdmin =
                member.roles.includes("ADMIN") && adminCount <= 1;

              return (
                <TableRow key={member.membershipId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        <AvatarImage
                          src={member.avatarUrl}
                          alt={member.name}
                        />
                        <AvatarFallback>
                          {member.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{member.name}</span>
                      {member.userId === currentUserId && (
                        <span className="text-xs text-muted-foreground">
                          {t("members.you")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.email}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {member.roles.map((role) => {
                        const Icon = ROLE_CONFIG[role].icon;
                        return (
                          <Badge key={role} variant={ROLE_CONFIG[role].variant}>
                            <Icon className="mr-1 h-3 w-3" />
                            {t(`members.roleLabels.${role}`)}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={isPending}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>
                          <ShieldCheck className="mr-1 inline h-3 w-3" />
                          {t("members.editRoles")}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {ALL_ROLES.map((role) => {
                          const checked = member.roles.includes(role);
                          const isOnlyRole =
                            checked && member.roles.length === 1;
                          const disableUncheck =
                            isOnlyRole ||
                            (role === "ADMIN" && isLastAdmin);

                          return (
                            <DropdownMenuCheckboxItem
                              key={role}
                              checked={checked}
                              disabled={isPending || disableUncheck}
                              onCheckedChange={() =>
                                handleRoleToggle(member, role)
                              }
                              onSelect={(e) => e.preventDefault()}
                            >
                              {t(`members.roleLabels.${role}`)}
                            </DropdownMenuCheckboxItem>
                          );
                        })}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          disabled={isPending || isLastAdmin}
                          onClick={() => setRemoveTarget(member)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t("members.removeMember")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onConfirm={handleRemove}
        title={t("members.removeMemberTitle")}
        description={t("members.removeMemberDescription", {
          name: removeTarget?.name ?? "",
        })}
        confirmLabel={t("members.removeMember")}
        confirmVariant="destructive"
        isPending={isPending}
      />
    </>
  );
}
