import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getActiveItems } from "@/lib/items";
import { StockCountForm } from "@/components/stock-count-form";
import { CountHistorySection, CountHistoryFallback } from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
  readonly searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function InventoryPage({ params, searchParams }: Props) {
  const { officeId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const items = await getActiveItems(officeId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("inventory.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("inventory.subtitle")}</p>
      </div>

      <StockCountForm
        officeId={officeId}
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          expectedQty: i.stockQty,
        }))}
      />

      <Suspense fallback={<CountHistoryFallback />}>
        <CountHistorySection officeId={officeId} page={page} />
      </Suspense>
    </div>
  );
}
