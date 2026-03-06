import { getTranslations } from "next-intl/server";
import { CreateOfficeForm } from "@/components/create-office-form";

export default async function CreateOfficePage() {
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("office.createTitle")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("office.createSubtitle")}
        </p>
      </div>
      <div className="max-w-md">
        <CreateOfficeForm />
      </div>
    </div>
  );
}
