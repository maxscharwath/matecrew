import { requireOrgRoles } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { CronList } from "@/components/cron-list";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function CronPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    select: { name: true },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('cron.title')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('cron.subtitle', { office: office.name })}
        </p>
      </div>
      <CronList officeId={officeId} />
    </div>
  );
}
