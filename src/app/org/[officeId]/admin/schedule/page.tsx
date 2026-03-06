import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { ScheduleEditor } from "@/components/schedule-editor";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function SchedulePage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const [office, sessions] = await Promise.all([
    prisma.office.findUniqueOrThrow({
      where: { id: officeId },
      select: { name: true },
    }),
    prisma.mateSession.findMany({
      where: { officeId },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      select: {
        id: true,
        dayOfWeek: true,
        startTime: true,
        cutoffTime: true,
        label: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('schedule.title')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('schedule.subtitle', { office: office.name })}
        </p>
      </div>
      <ScheduleEditor officeId={officeId} sessions={sessions} />
    </div>
  );
}
