import { prisma } from "@/lib/prisma";
import { sendJoinRequestEmail } from "@/lib/email";
import { buildJoinRequestMessage, sendSlackMessage } from "@/lib/slack";

/**
 * Fan-out notification to every ADMIN of the office: one email per admin
 * (in their own locale) plus a Slack DM for admins who have linked their
 * Slack user. Best-effort: failures are logged but never propagated, so a
 * busted Resend key or unlinked Slack workspace can't break the join action.
 */
export async function notifyAdminsOfJoinRequest(opts: {
  officeId: string;
  requesterUserId: string;
}): Promise<void> {
  const [office, requester, admins] = await Promise.all([
    prisma.office.findUnique({
      where: { id: opts.officeId },
      select: { id: true, name: true, locale: true },
    }),
    prisma.user.findUnique({
      where: { id: opts.requesterUserId },
      select: { name: true, email: true },
    }),
    prisma.membership.findMany({
      where: { officeId: opts.officeId, roles: { has: "ADMIN" } },
      select: {
        user: {
          select: { email: true, locale: true, slackUserId: true },
        },
      },
    }),
  ]);

  if (!office || !requester || admins.length === 0) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const reviewUrl = `${appUrl}/org/${office.id}/admin/members`;

  await Promise.allSettled(
    admins.flatMap(({ user }) => {
      const tasks: Promise<unknown>[] = [
        sendJoinRequestEmail({
          to: user.email,
          locale: user.locale,
          requesterName: requester.name,
          requesterEmail: requester.email,
          officeName: office.name,
          reviewUrl,
        }).catch((e) => {
          console.error("[notify-join-request] email failed", user.email, e);
        }),
      ];

      if (user.slackUserId) {
        tasks.push(
          (async () => {
            const { blocks, fallback } = await buildJoinRequestMessage({
              locale: user.locale,
              requesterName: requester.name,
              requesterEmail: requester.email,
              officeName: office.name,
              reviewUrl,
            });
            // Slack chat.postMessage accepts a user ID as `channel` and opens
            // an IM channel automatically.
            await sendSlackMessage(user.slackUserId!, blocks, fallback);
          })().catch((e) => {
            console.error(
              "[notify-join-request] slack dm failed",
              user.slackUserId,
              e,
            );
          }),
        );
      }

      return tasks;
    }),
  );
}
