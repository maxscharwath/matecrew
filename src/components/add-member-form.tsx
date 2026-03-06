"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { ChevronDown, ShieldCheck, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addMember } from "@/app/org/[officeId]/admin/members/actions";

type Role = "ADMIN" | "USER";

const ROLE_ICON: Record<Role, typeof ShieldCheck> = {
  ADMIN: ShieldCheck,
  USER: User,
};

const ALL_ROLES: Role[] = ["USER", "ADMIN"];

interface AddMemberFormProps {
  readonly officeId: string;
}

export function AddMemberForm({ officeId }: AddMemberFormProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(["USER"]);
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations();

  function toggleRole(role: Role) {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) {
        if (prev.length === 1) return prev;
        return prev.filter((r) => r !== role);
      }
      return [...prev, role].sort((a, b) => a.localeCompare(b));
    });
  }

  function handleSubmit(formData: FormData) {
    for (const role of selectedRoles) {
      formData.append("roles", role);
    }
    startTransition(async () => {
      const result = await addMember(officeId, formData);
      if (result.success) {
        toast.success(t("members.memberAdded"));
        formRef.current?.reset();
        setSelectedRoles(["USER"]);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          {t("members.addMember")}
        </CardTitle>
        <CardDescription>{t("members.addMemberDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-4">
          <div className="flex-1 space-y-2">
            <Label htmlFor="email">{t("members.email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t("members.emailPlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>{t("members.roles")}</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" type="button" className="gap-1.5">
                  <span className="text-sm">
                    {selectedRoles
                      .toSorted((a, b) => a.localeCompare(b))
                      .map((role) => t(`members.roleLabels.${role}`))
                      .join(", ")}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {ALL_ROLES.map((role) => {
                  const checked = selectedRoles.includes(role);
                  const isOnly = checked && selectedRoles.length === 1;
                  const Icon = ROLE_ICON[role];
                  return (
                    <DropdownMenuCheckboxItem
                      key={role}
                      checked={checked}
                      disabled={isOnly}
                      onCheckedChange={() => toggleRole(role)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      <Icon className="mr-1.5 h-3.5 w-3.5" />
                      {t(`members.roleLabels.${role}`)}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? t("members.adding") : t("members.addButton")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
