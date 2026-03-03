import { requireSession } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";
import { CreateOfficeForm } from "@/components/create-office-form";

export default async function CreateOfficePage() {
  await requireSession();
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 p-8">
        <div>
          <h1 className="text-2xl font-bold">{t("office.createTitle")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("office.createSubtitle")}
          </p>
        </div>
        <CreateOfficeForm />
      </div>
    </div>
  );
}
