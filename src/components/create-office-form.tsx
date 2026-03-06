"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createOffice } from "@/app/org/create/actions";

export function CreateOfficeForm() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createOffice(formData);
      if (result.success) {
        toast.success(t("office.officeCreated"));
        router.push(`/org/${result.officeId}/dashboard`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("office.details")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("office.name")}</Label>
            <Input
              id="name"
              name="name"
              placeholder={t("office.namePlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">{t("office.timezone")}</Label>
            <TimezoneCombobox name="timezone" defaultValue="Europe/Zurich" />
          </div>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? t("office.creating") : t("office.create")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
