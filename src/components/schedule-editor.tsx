"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2, Copy, Clock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  addSession,
  removeSession,
  updateSession,
  copyDaySchedule,
} from "@/app/org/[officeId]/admin/schedule/actions";
import { SCHEDULE_STEP_MINUTES } from "@/lib/date";

interface MateSession {
  id: string;
  dayOfWeek: number;
  startTime: string;
  cutoffTime: string;
  label: string | null;
}

interface ScheduleEditorProps {
  readonly officeId: string;
  readonly sessions: MateSession[];
}

// Show Mon-Sun order
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Convert SCHEDULE_STEP_MINUTES to seconds for HTML time input step attribute
const TIME_STEP = SCHEDULE_STEP_MINUTES * 60;

function TimeInput({
  value,
  onChange,
  ...props
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type">) {
  return (
    <Input
      type="time"
      step={TIME_STEP}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...props}
    />
  );
}

function SessionForm({
  officeId,
  dayOfWeek,
  initial,
  sessionId,
  onClose,
}: {
  readonly officeId: string;
  readonly dayOfWeek: number;
  readonly initial?: { startTime: string; cutoffTime: string; label: string };
  readonly sessionId?: string;
  readonly onClose: () => void;
}) {
  const t = useTranslations();
  const isEdit = !!sessionId;
  const [isPending, startTransition] = useTransition();
  const [startTime, setStartTime] = useState(initial?.startTime ?? "08:00");
  const [cutoffTime, setCutoffTime] = useState(initial?.cutoffTime ?? "10:00");
  const [label, setLabel] = useState(initial?.label ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = isEdit
        ? await updateSession(officeId, sessionId, startTime, cutoffTime, label)
        : await addSession(officeId, dayOfWeek, startTime, cutoffTime, label);
      if (result.success) {
        toast.success(isEdit ? t('schedule.sessionModified') : t('schedule.sessionAdded'));
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-muted/50 p-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">{t('schedule.start')}</Label>
          <TimeInput value={startTime} onChange={setStartTime} required />
        </div>
        <div>
          <Label className="text-xs">{t('schedule.close')}</Label>
          <TimeInput value={cutoffTime} onChange={setCutoffTime} required />
        </div>
        <div>
          <Label className="text-xs">{t('schedule.label')}</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('schedule.labelPlaceholder')}
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {t('schedule.timeAlignmentNote', { step: SCHEDULE_STEP_MINUTES })}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "..." : isEdit ? t('schedule.save') : t('schedule.addSession')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function SessionChip({
  session,
  officeId,
  isPending,
  onDelete,
  onEdit,
}: {
  readonly session: MateSession;
  readonly officeId: string;
  readonly isPending: boolean;
  readonly onDelete: (sessionId: string) => void;
  readonly onEdit: (sessionId: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <Clock className="size-3.5 text-muted-foreground" />
      <span className="text-sm font-medium">
        {session.startTime} – {session.cutoffTime}
      </span>
      {session.label && (
        <Badge variant="secondary" className="text-xs">
          {session.label}
        </Badge>
      )}
      <div className="ml-auto flex gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={isPending}
          onClick={() => onEdit(session.id)}
        >
          <Pencil className="size-3.5 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={isPending}
          onClick={() => onDelete(session.id)}
        >
          <Trash2 className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

function DayRow({
  dayOfWeek,
  sessions,
  officeId,
}: {
  readonly dayOfWeek: number;
  readonly sessions: MateSession[];
  readonly officeId: string;
}) {
  const t = useTranslations();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const DAY_LABELS = Array.from({ length: 7 }, (_, i) => t(`schedule.dayLabels.${i}`));

  function handleDelete(sessionId: string) {
    startTransition(async () => {
      const result = await removeSession(officeId, sessionId);
      if (result.success) {
        toast.success(t('schedule.sessionDeleted'));
      } else {
        toast.error(result.error);
      }
    });
  }

  const sorted = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{DAY_LABELS[dayOfWeek]}</h3>
        {!showAddForm && !editingId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="mr-1 size-3" />
            {t('schedule.addSession')}
          </Button>
        )}
      </div>

      {sorted.length === 0 && !showAddForm && (
        <p className="text-xs text-muted-foreground">{t('schedule.noSession')}</p>
      )}

      {sorted.map((session) =>
        editingId === session.id ? (
          <SessionForm
            key={session.id}
            officeId={officeId}
            dayOfWeek={dayOfWeek}
            sessionId={session.id}
            initial={{
              startTime: session.startTime,
              cutoffTime: session.cutoffTime,
              label: session.label ?? "",
            }}
            onClose={() => setEditingId(null)}
          />
        ) : (
          <SessionChip
            key={session.id}
            session={session}
            officeId={officeId}
            isPending={isPending}
            onDelete={handleDelete}
            onEdit={setEditingId}
          />
        ),
      )}

      {showAddForm && (
        <SessionForm
          officeId={officeId}
          dayOfWeek={dayOfWeek}
          onClose={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
}

function CopyScheduleDialog({
  officeId,
  sessions,
}: {
  readonly officeId: string;
  readonly sessions: MateSession[];
}) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [sourceDay, setSourceDay] = useState(1);
  const [targetDays, setTargetDays] = useState<number[]>([]);

  const DAY_SHORT = Array.from({ length: 7 }, (_, i) => t(`schedule.dayShort.${i}`));

  const daysWithSessions = [...new Set(sessions.map((s) => s.dayOfWeek))];

  function toggleTarget(day: number) {
    setTargetDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  function handleCopy() {
    if (targetDays.length === 0) return;
    startTransition(async () => {
      const result = await copyDaySchedule(officeId, sourceDay, targetDays);
      if (result.success) {
        toast.success(t('schedule.scheduleCopied'));
        setOpen(false);
        setTargetDays([]);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Copy className="mr-2 size-4" />
          {t('schedule.copyDay')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('schedule.copySchedule')}</DialogTitle>
          <DialogDescription>
            {t('schedule.copyDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t('schedule.copyFrom')}</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DAY_ORDER.map((day) => (
                <Button
                  key={day}
                  variant={sourceDay === day ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  disabled={!daysWithSessions.includes(day)}
                  onClick={() => setSourceDay(day)}
                >
                  {DAY_SHORT[day]}
                  {daysWithSessions.includes(day) && (
                    <span className="ml-1 text-xs opacity-60">
                      ({sessions.filter((s) => s.dayOfWeek === day).length})
                    </span>
                  )}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label>{t('schedule.copyTo')}</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DAY_ORDER.filter((d) => d !== sourceDay).map((day) => (
                <Button
                  key={day}
                  variant={targetDays.includes(day) ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() => toggleTarget(day)}
                >
                  {DAY_SHORT[day]}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleCopy}
            disabled={isPending || targetDays.length === 0}
          >
            {isPending ? t('schedule.copying') : t('schedule.copyToDays', { count: targetDays.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleEditor({ officeId, sessions }: ScheduleEditorProps) {
  const t = useTranslations();
  const sessionsByDay = new Map<number, MateSession[]>();
  for (const day of DAY_ORDER) {
    sessionsByDay.set(day, []);
  }
  for (const s of sessions) {
    sessionsByDay.get(s.dayOfWeek)?.push(s);
  }

  const totalSessions = sessions.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('schedule.sessionScheduleTitle')}</CardTitle>
            <CardDescription>
              {t('schedule.sessionCount', { count: totalSessions })}
            </CardDescription>
          </div>
          {totalSessions > 0 && (
            <CopyScheduleDialog officeId={officeId} sessions={sessions} />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {DAY_ORDER.map((day) => (
          <DayRow
            key={day}
            dayOfWeek={day}
            sessions={sessionsByDay.get(day) ?? []}
            officeId={officeId}
          />
        ))}
      </CardContent>
    </Card>
  );
}
