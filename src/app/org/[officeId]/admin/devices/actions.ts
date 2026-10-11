"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { prisma, newId } from "@/lib/prisma";
import { platform } from "@/platform";
import { requireOrgRoles } from "@/lib/auth-utils";
import { normalizeBadgeUid } from "@/lib/device/codes";
import { toRow, withId, type ConsoleCommand } from "@/lib/device/console-commands";
import { notifyTerminals } from "@/lib/device/push";
import { HHMM } from "@/lib/device/hours";
import { SOUNDS, soundsText } from "@/lib/device/sounds";
import { TIME_FORMATS, isTimeZone } from "@/lib/device/clock";
import { deviceTheme } from "@/lib/device/contract";
import type { LiveStatus } from "@/lib/device/live";
import { defaultDeviceTheme } from "@/lib/device/state";
import { locales } from "@/i18n/request";

/** The language choice that follows the office's. */
const OFFICE_LOCALE = "office";
/** The settings' "the office's time zone": stored as null. */
const OFFICE_ZONE = "office";

type ActionResult = { success: true } | { success: false; error: string };

function revalidateDevices(officeId: string) {
  revalidatePath(`/org/${officeId}/admin/devices`);
}

export async function updateDevice(
  officeId: string,
  deviceId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { session } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");

  const parsed = z
    .object({
      name: z.string().trim().min(1, t("nameRequired")).max(60),
      firstItemId: z.string().min(1).nullable(),
      locale: z.enum([OFFICE_LOCALE, ...locales]),
      theme: deviceTheme,
      openFrom: z.string().regex(HHMM, t("hours.invalid")),
      openUntil: z.string().regex(HHMM, t("hours.invalid")),
      openDays: z.array(z.coerce.number().int().min(0).max(6)),
      sounds: z.array(z.enum(SOUNDS)),
      timeFormat: z.enum(TIME_FORMATS),
      timezone: z.string().refine((zone) => zone === OFFICE_ZONE || isTimeZone(zone), t("time.invalidZone")),
    })
    .refine((hours) => hours.openFrom < hours.openUntil, { message: t("hours.invalid") })
    .safeParse({
      name: formData.get("name"),
      firstItemId: formData.get("firstItemId"),
      locale: formData.get("locale") ?? OFFICE_LOCALE,
      theme: formData.get("theme") ?? defaultDeviceTheme(),
      openFrom: formData.get("openFrom") ?? "07:30",
      openUntil: formData.get("openUntil") ?? "19:00",
      openDays: formData.getAll("openDays"),
      sounds: formData.getAll("sounds"),
      timeFormat: formData.get("timeFormat") ?? "24",
      timezone: formData.get("timezone") ?? OFFICE_ZONE,
    });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const device = await prisma.device.findFirst({
    where: { id: deviceId, officeId },
    select: { name: true, leftItemId: true, locale: true, theme: true, openFrom: true, openUntil: true, openDays: true, sounds: true, timeFormat: true, timezone: true },
  });
  if (!device) return { success: false, error: t("notFound") };
  const { name, firstItemId, openFrom, openUntil } = parsed.data;
  const openDays = [...new Set(parsed.data.openDays)].sort((a, b) => a - b).join(",");
  const sounds = soundsText(parsed.data.sounds);
  const { timeFormat } = parsed.data;
  const timezone = parsed.data.timezone === OFFICE_ZONE ? null : parsed.data.timezone;
  if (firstItemId && !(await prisma.item.count({ where: { id: firstItemId, officeId } }))) {
    return { success: false, error: t("notFound") };
  }
  // Null follows the office's language and the site's theme, as long as they are the ones chosen.
  const locale = parsed.data.locale === OFFICE_LOCALE ? null : parsed.data.locale;
  const theme = parsed.data.theme === defaultDeviceTheme() ? null : parsed.data.theme;

  // The picker opens on the left key's item; that is all the keys still have to set.
  await prisma.device.update({
    where: { id: deviceId },
    data: { name, leftItemId: firstItemId, locale, theme, openFrom, openUntil, openDays, sounds, timeFormat, timezone },
  });
  // What the terminal shows changed: a sync, as the console's button sends, redraws it now (or
  // at its next connection).
  const before = [device.name, device.leftItemId, device.locale, device.theme, device.openFrom, device.openUntil, device.openDays, device.sounds, device.timeFormat, device.timezone];
  const changed = before.some((value, i) => value !== [name, firstItemId, locale, theme, openFrom, openUntil, openDays, sounds, timeFormat, timezone][i]);
  if (changed && platform.relay.terminalUrl()) {
    notifyTerminals([deviceId]);
  } else if (changed) {
    await prisma.deviceCommand.create({ data: { deviceId, sentById: session.user.id, ...toRow({ kind: "sync" }) } });
  }
  revalidateDevices(officeId);
  return { success: true };
}

/** Deleting the device deletes its token hash: its next call gets a 401 and it starts linking again. */
export async function revokeDevice(officeId: string, deviceId: string): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  await prisma.device.deleteMany({ where: { id: deviceId, officeId } });
  revalidateDevices(officeId);
  return { success: true };
}

export async function assignBadge(
  officeId: string,
  badgeId: string,
  userId: string | null,
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");
  if (userId) {
    const member = await prisma.membership.findUnique({
      where: { userId_officeId: { userId, officeId } },
      select: { id: true },
    });
    if (!member) return { success: false, error: t("notFound") };
  }
  const updated = await prisma.badge.updateMany({ where: { id: badgeId, officeId }, data: { userId } });
  if (updated.count === 0) return { success: false, error: t("notFound") };
  revalidateDevices(officeId);
  return { success: true };
}

const consoleCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), side: z.enum(["left", "right"]) }),
  z.object({ kind: z.literal("longKey"), side: z.enum(["left", "right"]) }),
  z.object({ kind: z.literal("both") }),
  z.object({ kind: z.literal("badge"), uid: z.string() }),
  z.object({ kind: z.literal("sync"), app: z.enum(["mate", "showcase"]).optional() }),
  z.object({ kind: z.literal("tap"), x: z.number().int().min(0).max(199), y: z.number().int().min(0).max(119) }),
  z.object({ kind: z.literal("restart") }),
  z.object({ kind: z.literal("forgetWifi") }),
  z.object({ kind: z.literal("sleep") }),
]);

/**
 * A command from the console, when its socket to the relay is not open: through the relay
 * (the terminal gets it now, or when it connects), else queued for the terminal's next poll.
 * Returns it as the console's monitor lists it, waiting.
 */
export async function sendDeviceCommand(
  officeId: string,
  deviceId: string,
  input: ConsoleCommand,
): Promise<{ success: true; command: LiveStatus["commands"][number] } | { success: false; error: string }> {
  const { session } = await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");
  const parsed = consoleCommand.safeParse(input);
  if (!parsed.success) return { success: false, error: t("notFound") };

  let command: ConsoleCommand = parsed.data;
  if (command.kind === "badge") {
    const uid = normalizeBadgeUid(command.uid);
    if (!uid) return { success: false, error: t("console.invalidUid") };
    command = { kind: "badge", uid };
  }

  const device = await prisma.device.findFirst({ where: { id: deviceId, officeId }, select: { id: true } });
  if (!device) return { success: false, error: t("notFound") };
  const id = newId();
  const relayed = await platform.relay.command(deviceId, withId(command, id), session.user.id);
  if (relayed) {
    const status = relayed === "sent" ? "waiting" : relayed;
    return { success: true, command: { id, ...toRow(command), createdAt: new Date().toISOString(), status } };
  }
  const row = await prisma.deviceCommand.create({
    data: { deviceId, sentById: session.user.id, ...toRow(command) },
    select: { id: true, kind: true, arg: true, createdAt: true },
  });
  return { success: true, command: { ...row, createdAt: row.createdAt.toISOString(), status: "waiting" } };
}

/**
 * Where the console opens its socket to the terminal's relay, with a one-time ticket: asked again
 * at each reconnection. Null without a relay: the console polls.
 */
export async function consoleSocket(officeId: string, deviceId: string): Promise<{ url: string; ticket: string } | null> {
  const { session } = await requireOrgRoles(officeId, "ADMIN");
  const device = await prisma.device.findFirst({ where: { id: deviceId, officeId }, select: { id: true } });
  if (!device) return null;
  return platform.relay.console(deviceId, session.user.id);
}

/**
 * Forgets a badge a terminal read, and so unlinks it from its holder. Read again, it comes back
 * as an unknown badge. Its takes keep their UID (`DeviceTake.badgeUid` is not a relation).
 */
export async function deleteBadge(officeId: string, badgeId: string): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations("devices");
  const deleted = await prisma.badge.deleteMany({ where: { id: badgeId, officeId } });
  if (deleted.count === 0) return { success: false, error: t("badgeNotFound") };
  revalidateDevices(officeId);
  return { success: true };
}
