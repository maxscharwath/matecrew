"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";
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
import { addMember } from "@/app/org/[officeId]/admin/members/actions";

type Role = "ADMIN" | "USER";

const ALL_ROLES: Role[] = ["USER", "ADMIN"];

interface AddMemberFormProps {
  readonly officeId: string;
}

export function AddMemberForm({ officeId }: AddMemberFormProps) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await addMember(officeId, formData);
      if (result.success) {
        toast.success(t("members.memberAdded"));
        formRef.current?.reset();
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
            <div className="flex gap-1">
              {ALL_ROLES.map((role) => (
                <label key={role} className="cursor-pointer">
                  <input
                    type="checkbox"
                    name="roles"
                    value={role}
                    defaultChecked={role === "USER"}
                    className="peer sr-only"
                  />
                  <span className="inline-block rounded-md border px-3 py-2 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
                    {t(`members.roleLabels.${role}`)}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? t("members.adding") : t("members.addButton")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
