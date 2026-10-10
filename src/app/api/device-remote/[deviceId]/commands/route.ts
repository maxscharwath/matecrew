import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { adminDevice } from "@/lib/device/admin";
import { normalizeBadgeUid } from "@/lib/device/codes";
import { toRow, type ConsoleCommand } from "@/lib/device/commands";

/** The command shape of `@matecrew/device-link`, the same as over Bluetooth. */
const remoteCommand = z.discriminatedUnion("cmd", [
  z.object({ cmd: z.literal("key"), side: z.enum(["left", "right"]) }),
  z.object({ cmd: z.literal("both") }),
  z.object({ cmd: z.literal("badge"), uid: z.string() }),
  z.object({ cmd: z.literal("sync") }),
  z.object({ cmd: z.literal("restart") }),
  z.object({ cmd: z.literal("notify"), text: z.string() }),
  z.object({ cmd: z.literal("tap"), x: z.number().int().min(0).max(199), y: z.number().int().min(0).max(119) }),
]);

/**
 * `HttpRemote` (`@matecrew/device-link`) for an admin of the terminal's office: queues the
 * command for the terminal's console long-poll, as the console page does. Notifications have
 * no console command yet: 501.
 */
export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const owner = await prisma.device.findUnique({ where: { id: deviceId }, select: { officeId: true } });
  if (!owner) return new Response(null, { status: 404 });
  const found = await adminDevice(owner.officeId, deviceId);
  if ("error" in found) return found.error;

  const parsed = remoteCommand.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const body = parsed.data;
  let command: ConsoleCommand;
  switch (body.cmd) {
    case "key":
      command = { kind: "key", side: body.side };
      break;
    case "both":
      command = { kind: "both" };
      break;
    case "badge": {
      const uid = normalizeBadgeUid(body.uid);
      if (!uid) return Response.json({ error: "invalid_request", message: "not a badge UID" }, { status: 400 });
      command = { kind: "badge", uid };
      break;
    }
    case "sync":
      command = { kind: "sync" };
      break;
    case "restart":
      command = { kind: "restart" };
      break;
    case "tap":
      command = { kind: "tap", x: body.x, y: body.y };
      break;
    default:
      return Response.json({ error: "unsupported", message: `no remote "${body.cmd}" through the site` }, { status: 501 });
  }
  await prisma.deviceCommand.create({ data: { deviceId, sentById: found.userId, ...toRow(command) } });
  return new Response(null, { status: 204 });
}
