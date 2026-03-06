import { Suspense } from "react";
import { requireOrgRoles } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { PurchaseForm } from "@/components/purchase-form";
import { getTranslations } from "next-intl/server";
import { PurchaseListSection, PurchaseListFallback } from "./_sections";

interface Props {
  readonly params: Promise<{ officeId: string }>;
  readonly searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function PurchasesPage({ params, searchParams }: Props) {
  const { officeId } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  const memberships = await prisma.membership.findMany({
    where: { officeId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  const members = memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('purchases.title')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('purchases.subtitle')}
        </p>
      </div>

      <PurchaseForm officeId={officeId} members={members} />

      <Suspense fallback={<PurchaseListFallback />}>
        <PurchaseListSection officeId={officeId} page={page} />
      </Suspense>
    </div>
  );
}
