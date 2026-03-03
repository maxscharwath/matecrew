"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
  updateOffice,
  testSlackWebhook,
} from "@/app/org/[officeId]/admin/settings/actions";

interface Office {
  id: string;
  name: string;
  timezone: string;
  slackWebhookUrl: string | null;
  slackChannelLabel: string | null;
  lowStockThreshold: number;
}

interface OfficeSettingsFormProps {
  readonly office: Office;
}

export function OfficeSettingsForm({ office }: OfficeSettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateOffice(office.id, formData);
      if (result.success) {
        toast.success(t('settings.settingsSaved'));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleTestSlack() {
    startTransition(async () => {
      const result = await testSlackWebhook(office.id);
      if (result.success) {
        toast.success(t('settings.testMessageSent'));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.generalTitle')}</CardTitle>
        <CardDescription>
          {t('settings.generalDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('settings.name')}</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={office.name}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">{t('settings.timezone')}</Label>
            <Input
              id="timezone"
              name="timezone"
              defaultValue={office.timezone}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slackWebhookUrl">{t('settings.slackWebhookUrl')}</Label>
            <div className="flex gap-2">
              <Input
                id="slackWebhookUrl"
                name="slackWebhookUrl"
                type="url"
                defaultValue={office.slackWebhookUrl ?? ""}
                placeholder={t('settings.slackWebhookPlaceholder')}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleTestSlack}
              >
                {t('settings.test')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="slackChannelLabel">{t('settings.slackChannelLabel')}</Label>
            <Input
              id="slackChannelLabel"
              name="slackChannelLabel"
              defaultValue={office.slackChannelLabel ?? ""}
              placeholder={t('settings.slackChannelPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lowStockThreshold">{t('settings.lowStockThreshold')}</Label>
            <Input
              id="lowStockThreshold"
              name="lowStockThreshold"
              type="number"
              min={0}
              defaultValue={office.lowStockThreshold}
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? t('settings.saving') : t('settings.saveChanges')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
