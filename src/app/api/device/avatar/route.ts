import { prisma } from "@/lib/prisma";
import { authenticateDevice, unauthorized } from "@/lib/device/auth";
import { accountRequest, type AvatarResponse } from "@/lib/device/contract";
import { AVATAR_SIDE, avatarPicture } from "@/lib/device/avatar";
import { badgeHolder } from "@/lib/device/purchases";

/**
 * The badge holder's picture for the menu the terminal opens after a badge, asked live so the
 * terminal keeps none. A POST so the badge stays out of URLs and access logs; a badge nobody holds
 * in the terminal's office is a 404 `unknown_badge`, as for the account.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return unauthorized();
  const parsed = accountRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const userId = await badgeHolder(device, parsed.data.badgeUid);
  if (!userId) return Response.json({ error: "unknown_badge" }, { status: 404 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } });
  const body: AvatarResponse = { avatar: await avatarPicture(userId, user?.image, AVATAR_SIDE.served) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
