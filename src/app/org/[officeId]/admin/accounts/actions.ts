"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRoles } from "@/lib/auth-utils";
import { getTranslations } from "next-intl/server";
import { mergeAccounts, MergeError, type MergeErrorCode } from "@/lib/account-merge";

type ActionResult = { success: true } | { success: false; error: string };

const ERROR_KEY: Record<MergeErrorCode, string> = {
  SAME_ACCOUNT: "errors.mergeSameAccount",
  NOT_FOUND: "errors.mergeNotFound",
  IDENTITY_MISMATCH: "errors.mergeIdentityMismatch",
};

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
    if (e instanceof MergeError) {
      return { success: false, error: t(ERROR_KEY[e.code]) };
    }
    // Unexpected (DB, conflict, etc.) — log server-side, show a generic message.
    console.error("Account merge failed:", e);
    return { success: false, error: t("errors.mergeFailed") };
  }

  revalidatePath(`/org/${officeId}/admin/accounts`);
  return { success: true };
}
