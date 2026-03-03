import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { OfficeSettingsForm } from "@/components/office-settings-form";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function SettingsPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");

  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
  });

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Office Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage settings for {office.name}.
        </p>
      </div>
      <OfficeSettingsForm office={office} />
    </div>
  );
}
