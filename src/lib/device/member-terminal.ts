import { prisma } from "@/lib/prisma";
import { buildAccount } from "@/lib/device/account";
import { withOwnLocale } from "@/lib/device/auth";
import { buildDeviceState } from "@/lib/device/state";
import type { DemoOffice } from "@/lib/device/virtual/demo";

/**
 * The office's terminal as a member meets it in 3D on the dashboard: what its screen shows (items,
 * stock, office name, its last battery and Wi-Fi readings) and the member's own account, for the
 * firmware's WebAssembly to draw in the browser. Nothing there reaches the site: a take on the 3D
 * screen stays on it, and cancelling a purchase there is refused. The badge UIDs stay here; the 3D
 * reader badges the member. Null when the office has no terminal.
 */
export async function memberTerminal(officeId: string, userId: string): Promise<DemoOffice | null> {
  const device = await prisma.device.findFirst({
    where: { officeId },
    orderBy: { lastSeenAt: "desc" },
    include: { office: true },
  });
  if (!device) return null;
  const terminal = withOwnLocale(device);
  const [state, account] = await Promise.all([buildDeviceState(terminal), buildAccount(terminal, userId)]);
  return {
    state: { ...state, badges: [], firmware: null, realtime: null, appUrl: null },
    account,
  };
}
