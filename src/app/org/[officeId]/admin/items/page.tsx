import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";
import { resolveItemImageUrl } from "@/lib/storage";
import { ITEM_DISPLAY_ORDER, sumStockQty } from "@/lib/items";
import { ItemsManager } from "@/components/items-manager";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function ItemsPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const items = await prisma.item.findMany({
    where: { officeId },
    orderBy: ITEM_DISPLAY_ORDER,
    select: {
      id: true,
      name: true,
      imageKey: true,
      active: true,
      isDefault: true,
      stock: { select: { currentQty: true } },
      _count: { select: { consumptionEntries: true } },
    },
  });

  const rows = items.map((i) => ({
    id: i.id,
    name: i.name,
    imageUrl: resolveItemImageUrl(i.imageKey),
    active: i.active,
    isDefault: i.isDefault,
    stockQty: sumStockQty(i.stock),
    consumptionCount: i._count.consumptionEntries,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("items.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("items.subtitle")}</p>
      </div>
      <ItemsManager officeId={officeId} items={rows} />
    </div>
  );
}
