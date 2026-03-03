"use client";

import { useTransition } from "react";
import { toast } from "sonner";
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
  dailyPostTime: string;
  lowStockThreshold: number;
}

interface OfficeSettingsFormProps {
  readonly office: Office;
}

export function OfficeSettingsForm({ office }: OfficeSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateOffice(office.id, formData);
      if (result.success) {
        toast.success("Settings saved");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleTestSlack() {
    startTransition(async () => {
      const result = await testSlackWebhook(office.id);
      if (result.success) {
        toast.success("Test message sent!");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          Update your office configuration and Slack integration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={office.name}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              name="timezone"
              defaultValue={office.timezone}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slackWebhookUrl">Slack Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                id="slackWebhookUrl"
                name="slackWebhookUrl"
                type="url"
                defaultValue={office.slackWebhookUrl ?? ""}
                placeholder="https://hooks.slack.com/services/..."
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={handleTestSlack}
              >
                Test
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="slackChannelLabel">Slack Channel Label</Label>
            <Input
              id="slackChannelLabel"
              name="slackChannelLabel"
              defaultValue={office.slackChannelLabel ?? ""}
              placeholder="#maté-lausanne"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dailyPostTime">Daily Post Time</Label>
              <Input
                id="dailyPostTime"
                name="dailyPostTime"
                defaultValue={office.dailyPostTime}
                placeholder="10:00"
                pattern="\d{2}:\d{2}"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lowStockThreshold">Low Stock Threshold</Label>
              <Input
                id="lowStockThreshold"
                name="lowStockThreshold"
                type="number"
                min={0}
                defaultValue={office.lowStockThreshold}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
