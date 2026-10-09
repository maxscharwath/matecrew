import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { verifyClaim, type ClaimParams } from "@/lib/device/badge-claim";
import { BadgeClaim } from "@/components/badge-claim";

interface Props {
  readonly searchParams: Promise<ClaimParams>;
}

/**
 * Where a member links their badge to their account: a terminal that reads
 * an unknown badge shows a QR to this page, signed with its own token.
 */
export default async function BadgePage({ searchParams }: Props) {
  const params = await searchParams;
  const session = await getOptionalSession();
  if (!session) {
    const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`/sign-in?redirectTo=${encodeURIComponent(`/badge?${query}`)}`);
  }
  const t = await getTranslations("badgeClaim");
  const claim = await verifyClaim(params);

  let state: Parameters<typeof BadgeClaim>[0]["state"];
  if (!claim.ok) {
    state = { kind: claim.reason };
  } else {
    const officeId = claim.device.office.id;
    const [member, badge] = await Promise.all([
      prisma.membership.findUnique({ where: { userId_officeId: { userId: session.user.id, officeId } }, select: { id: true } }),
      prisma.badge.findUnique({
        where: { officeId_uid: { officeId, uid: claim.uid } },
        select: { userId: true, user: { select: { name: true } } },
      }),
    ]);
    const context = { uid: claim.uid, office: claim.device.office.name, device: claim.device.name };
    if (!member) state = { kind: "notMember", ...context };
    else if (badge?.userId === session.user.id) state = { kind: "yours", ...context };
    else if (badge?.userId) state = { kind: "taken", holder: badge.user?.name ?? "", ...context };
    else state = { kind: "claimable", ...context };
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <BadgeClaim params={params} state={state} />
    </main>
  );
}
