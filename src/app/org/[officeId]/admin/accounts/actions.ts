"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";
import { mergeAccounts } from "@/lib/account-merge";

type ActionResult = { success: true } | { success: false; error: string };

/**
 * Merge a duplicate account (`sourceUserId`) into the account the admin chose
 * to keep (`targetUserId`). Gated behind office admin like every other admin
 * action, though the merge itself is account-global.
 */
export async function mergeAccountsAction(
  officeId: string,
  targetUserId: string,
  sourceUserId: string
): Promise<ActionResult> {
  await requireOrgRoles(officeId, "ADMIN");
  const t = await getTranslations();

  try {
    await mergeAccounts(targetUserId, sourceUserId);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : t("errors.mergeFailed"),
    };
  }

  revalidatePath(`/org/${officeId}/admin/accounts`);
  return { success: true };
}
