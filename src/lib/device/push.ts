import { platform } from "@/platform";
import { prisma } from "@/lib/prisma";

/**
 * "What you show changed": the terminals sync at once instead of finding out at their next
 * scheduled sync. Through the realtime relay (`platform.relay`); nothing without one.
 *
 * `src/lib/prisma.ts` calls `wrote` after every write, so no change is forgotten: a write to a
 * model the terminals show (their state, src/lib/device/state.ts) notifies them all. Terminals
 * are few, and a terminal that synced since the change skips the notice (`at`).
 */

/** Models whose rows end up in a terminal's state. Not `device`: its own status and screen are written on each sync. */
const SHOWN = new Set([
  "item",
  "stock",
  "stockMovement",
  "badge",
  "office",
  "firmwareRelease",
  "dailyRequest",
  "mateSession",
]);

/** Writes this close together make one notice. */
const GATHER_MS = 50;

type Scope = { all: boolean; devices: Set<string> };
let gathering: Scope | null = null;

/** After a write to `model` (Prisma's model key, `stockMovement`). */
export function wrote(model: string) {
  if (SHOWN.has(model)) notifyTerminals();
}

/** Tells these terminals, or all of them, that what they show changed; returns at once. */
export function notifyTerminals(deviceIds?: readonly string[]) {
  if (!platform.relay.terminalUrl()) return;
  if (!gathering) {
    gathering = { all: false, devices: new Set() };
    platform.runInBackground(send(), "terminal change notice");
  }
  if (deviceIds) deviceIds.forEach((id) => gathering?.devices.add(id));
  else gathering.all = true;
}

async function send() {
  await new Promise((resolve) => setTimeout(resolve, GATHER_MS));
  const scope = gathering;
  gathering = null;
  if (!scope) return;
  // After the writes it was asked for: a terminal whose state is newer already has them.
  const at = Date.now();
  const ids = scope.all ? (await prisma.device.findMany({ select: { id: true } })).map((d) => d.id) : [...scope.devices];
  await platform.relay.changed(ids, at);
}
