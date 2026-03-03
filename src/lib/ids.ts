import { z } from "zod";

// ─── Branded ID types ────────────────────────────────────
// Prevents accidentally passing a UserId where an OfficeId is expected.
// Usage: pass raw strings through the parser to get a branded type.
//   const userId = UserId.parse(someString);
//   const officeId = OfficeId.parse(someString);
//   fn(userId)    // ✅ if fn expects UserId
//   fn(officeId)  // ❌ type error if fn expects UserId

export const UserId = z.string().brand("UserId");
export type UserId = z.infer<typeof UserId>;

export const OfficeId = z.string().brand("OfficeId");
export type OfficeId = z.infer<typeof OfficeId>;

export const DailyRequestId = z.string().brand("DailyRequestId");
export type DailyRequestId = z.infer<typeof DailyRequestId>;

export const PurchaseBatchId = z.string().brand("PurchaseBatchId");
export type PurchaseBatchId = z.infer<typeof PurchaseBatchId>;

export const InvoiceFileId = z.string().brand("InvoiceFileId");
export type InvoiceFileId = z.infer<typeof InvoiceFileId>;

export const ConsumptionEntryId = z.string().brand("ConsumptionEntryId");
export type ConsumptionEntryId = z.infer<typeof ConsumptionEntryId>;

export const ReimbursementPeriodId = z.string().brand("ReimbursementPeriodId");
export type ReimbursementPeriodId = z.infer<typeof ReimbursementPeriodId>;

export const ReimbursementLineId = z.string().brand("ReimbursementLineId");
export type ReimbursementLineId = z.infer<typeof ReimbursementLineId>;

export const SessionId = z.string().brand("SessionId");
export type SessionId = z.infer<typeof SessionId>;

export const AccountId = z.string().brand("AccountId");
export type AccountId = z.infer<typeof AccountId>;
