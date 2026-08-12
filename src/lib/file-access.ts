import { prisma } from "@/lib/prisma";

/**
 * Who may read a stored file.
 *
 * Storage keys are structural, not secret. A settlement PDF lives at
 * `reimbursements/<version>/<periodId>/user-<userId>.pdf`, and both ids appear in
 * the app's own UI, so anyone who works out the shape can name another person's
 * document. Requiring a session closes off the open internet; this decides
 * whether *this* session is entitled to *this* key.
 *
 * Unrecognised prefixes are denied rather than allowed, so a new kind of upload
 * cannot become world-readable just by not being listed here.
 */

export type FileAudience =
  /** Shown to everyone and fetched by Slack with no cookies. */
  | { kind: "public" }
  /** Requires a session, and a rule below must also grant it. */
  | { kind: "restricted" };

const PUBLIC_PREFIXES = ["avatars/", "items/"] as const;

export function audienceForKey(key: string): FileAudience {
  return PUBLIC_PREFIXES.some((p) => key.startsWith(p))
    ? { kind: "public" }
    : { kind: "restricted" };
}

/** True when `userId` is an admin of the office that owns `officeId`. */
async function isOfficeAdmin(
  userId: string,
  officeId: string,
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { userId_officeId: { userId, officeId } },
    select: { roles: true },
  });
  return membership?.roles.includes("ADMIN") ?? false;
}

async function isOfficeMember(
  userId: string,
  officeId: string,
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { userId_officeId: { userId, officeId } },
    select: { id: true },
  });
  return membership !== null;
}

/**
 * Decides whether a signed-in user may read a restricted key.
 *
 * Errs closed: an unparseable key, a missing period or an unknown prefix all
 * deny. The cost of a false deny is a regenerated PDF; the cost of a false allow
 * is leaking someone's finances.
 */
export async function canReadFile(
  userId: string,
  key: string,
): Promise<boolean> {
  // reimbursements/<version>/<periodId>/settlement.pdf
  // reimbursements/<version>/<periodId>/user-<targetUserId>.pdf
  if (key.startsWith("reimbursements/")) {
    const parts = key.split("/");
    if (parts.length !== 4) return false;
    const [, , periodId, filename] = parts;

    const period = await prisma.reimbursementPeriod.findUnique({
      where: { id: periodId },
      select: { officeId: true },
    });
    if (!period) return false;

    const perUser = /^user-(.+)\.pdf$/.exec(filename);
    if (perUser) {
      // Your own statement, or an admin of the office it belongs to.
      if (perUser[1] === userId) return true;
      return isOfficeAdmin(userId, period.officeId);
    }
    // The office-wide settlement: any member of that office may read it, which
    // matches who can already see the figures on the reimbursements screen.
    return isOfficeMember(userId, period.officeId);
  }

  // invoices/<purchaseBatchId>/<file>
  if (key.startsWith("invoices/")) {
    const parts = key.split("/");
    if (parts.length < 3) return false;
    const batch = await prisma.purchaseBatch.findUnique({
      where: { id: parts[1] },
      select: { officeId: true },
    });
    if (!batch) return false;
    // Invoices are an admin surface in the UI, so keep them admin-only here.
    return isOfficeAdmin(userId, batch.officeId);
  }

  return false;
}
