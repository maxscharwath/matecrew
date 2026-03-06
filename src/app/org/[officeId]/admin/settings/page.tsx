import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { OfficeSettingsForm } from "@/components/office-settings-form";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function SettingsPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('settings.subtitle', { office: office.name })}
        </p>
      </div>
      <OfficeSettingsForm office={office} />
    </div>
  );
}
