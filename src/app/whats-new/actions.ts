"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth-utils";
import {
  markAllRead,
  markRead,
  markUnread,
} from "@/lib/whats-new/read-state";

type ActionResult = { success: true } | { success: false; error: string };

/**
 * Read state is always the caller's own — the user id comes from the session,
 * never from an argument, so one user can't mark articles read for another.
 */

export async function markArticleReadAction(
  slug: string,
): Promise<ActionResult> {
  const session = await requireSession();
  await markRead(session.user.id, slug);
  revalidateWhatsNew();
  return { success: true };
}

export async function markArticleUnreadAction(
  slug: string,
): Promise<ActionResult> {
  const session = await requireSession();
  await markUnread(session.user.id, slug);
  revalidateWhatsNew();
  return { success: true };
}

export async function markAllArticlesReadAction(): Promise<
  { success: true; count: number } | { success: false; error: string }
> {
  const session = await requireSession();
  const count = await markAllRead(session.user.id);
  revalidateWhatsNew();
  return { success: true, count };
}

/** The list, every article page, and the sidebar badge all show read state. */
function revalidateWhatsNew(): void {
  revalidatePath("/whats-new");
  revalidatePath("/whats-new", "layout");
  revalidatePath("/", "layout");
}
