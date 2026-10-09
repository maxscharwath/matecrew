import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { formatUserCode } from "@/lib/device/codes";
import { DeviceLinkForm } from "@/components/device-link-form";
import { findPendingLink } from "@/lib/device/links";

interface Props {
  readonly searchParams: Promise<{ code?: string }>;
}

/**
 * Where an admin approves a terminal: the terminal's QR opens this page with
 * its code, or the code is typed by hand.
 */
export default async function LinkDevicePage({ searchParams }: Props) {
  const { code } = await searchParams;
  const session = await getOptionalSession();
  if (!session) {
    const back = code ? `/link?code=${encodeURIComponent(code)}` : "/link";
    redirect(`/sign-in?redirectTo=${encodeURIComponent(back)}`);
  }
  const t = await getTranslations("deviceLink");

  const link = code ? await findPendingLink(code) : null;
  const adminOffices = await prisma.office.findMany({
    where: { memberships: { some: { userId: session.user.id, roles: { has: "ADMIN" } } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <DeviceLinkForm
        initialCode={code ?? ""}
        codeIsInvalid={Boolean(code) && !link}
        request={
          link
            ? {
                code: formatUserCode(link.userCode),
                hardwareId: link.hardwareId,
                requestedAt: link.createdAt.toISOString(),
              }
            : null
        }
        offices={adminOffices}
      />
    </main>
  );
}
