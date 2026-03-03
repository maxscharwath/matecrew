import { prisma } from "@/lib/prisma";
import { requireOrgRoles } from "@/lib/auth-utils";
import { resolveAvatarUrl } from "@/lib/r2-helpers";
import { PurchaseForm } from "@/components/purchase-form";
import { PurchaseList } from "@/components/purchase-list";
import { getTranslations } from "next-intl/server";

interface Props {
  readonly params: Promise<{ officeId: string }>;
}

export default async function PurchasesPage({ params }: Props) {
  const { officeId } = await params;
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const [batches, memberships] = await Promise.all([
    prisma.purchaseBatch.findMany({
      where: { officeId },
      orderBy: { purchasedAt: "desc" },
      include: {
        paidBy: { select: { name: true, image: true } },
        invoices: { select: { id: true, filename: true } },
      },
    }),
    prisma.membership.findMany({
      where: { officeId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const members = memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
  }));

  const serializedBatches = await Promise.all(
    batches.map(async (b) => ({
      id: b.id,
      status: b.status as "ORDERED" | "DELIVERED",
      purchasedAt: b.purchasedAt.toISOString(),
      qty: b.qty,
      unitPrice: b.unitPrice.toNumber(),
      totalPrice: b.totalPrice.toNumber(),
      paidByName: b.paidBy.name,
      paidByImage: await resolveAvatarUrl(b.paidBy.image),
      notes: b.notes,
      invoices: b.invoices,
    })),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-bold">{t('purchases.title')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('purchases.subtitle')}
        </p>
      </div>

      <PurchaseForm officeId={officeId} members={members} />
      <PurchaseList officeId={officeId} batches={serializedBatches} />
    </div>
  );
}
