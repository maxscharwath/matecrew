"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Play, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { triggerCron } from "@/app/org/[officeId]/admin/cron/actions";
import cronSchedules from "../../cron-schedules.json";

interface CronListProps {
  readonly officeId: string;
}

function CronJobRow({
  officeId,
  job,
}: {
  readonly officeId: string;
  readonly job: (typeof cronSchedules)[number];
}) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<string | null>(null);

  function handleTrigger() {
    setLastResult(null);
    startTransition(async () => {
      const result = await triggerCron(officeId, job.id);
      if (result.success) {
        toast.success(result.message);
        setLastResult(result.message);
      } else {
        toast.error(result.error);
        setLastResult(result.error);
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{job.name}</span>
          <Badge variant="outline" className="font-mono text-xs">
            <Clock className="mr-1 size-3" />
            {job.cron}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{job.description}</p>
        <p className="font-mono text-xs text-muted-foreground">{job.path}</p>
        {lastResult && (
          <p className="mt-1 text-xs text-muted-foreground italic">{lastResult}</p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleTrigger}
        disabled={isPending}
        className="shrink-0"
      >
        {isPending ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Play className="mr-2 size-4" />
        )}
        {isPending ? t('cron.executing') : t('cron.execute')}
      </Button>
    </div>
  );
}

export function CronList({ officeId }: CronListProps) {
  const t = useTranslations();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('cron.scheduledTasks')}</CardTitle>
        <CardDescription>
          {t('cron.taskCount', { count: cronSchedules.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {cronSchedules.map((job) => (
          <CronJobRow key={job.id} officeId={officeId} job={job} />
        ))}
      </CardContent>
    </Card>
  );
}
