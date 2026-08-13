import type { ConsumptionShare, ItemPrice, PaymentLine } from "@/lib/reimbursement-calc";
import { toISODateString } from "@/lib/date";

/**
 * Quotes a value for CSV, doubling any embedded quote as RFC 4180 requires.
 * A member called `Jean "JJ" Dupont` otherwise terminates the field early and
 * shifts every column after it, silently misattributing the amounts.
 */
function field(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function generateReimbursementCsv(data: {
  officeName: string;
  startDate: Date;
  endDate: Date;
  totalConsumption: number;
  totalCost: number;
  drinkCost: number;
  lossQty: number;
  lossCost: number;
  unallocatedLossCost: number;
  itemPrices: ItemPrice[];
  shares: ConsumptionShare[];
  lines: PaymentLine[];
}): string {
  const rows: string[] = [];

  rows.push(`Reimbursement Report - ${data.officeName}`);
  rows.push(
    `Period: ${toISODateString(data.startDate)} to ${toISODateString(data.endDate)}`
  );
  rows.push(`Total consumption: ${data.totalConsumption}`);
  rows.push(`Consumption cost: CHF ${data.drinkCost.toFixed(2)}`);
  rows.push(`Missing at inventory: ${data.lossQty}`);
  rows.push(`Shrinkage cost: CHF ${data.lossCost.toFixed(2)}`);
  if (Math.abs(data.unallocatedLossCost) > 0.005) {
    rows.push(
      `Shrinkage left on the buyer: CHF ${data.unallocatedLossCost.toFixed(2)}`
    );
  }
  rows.push(`Total cost: CHF ${data.totalCost.toFixed(2)}`);
  rows.push("");

  rows.push("Item,Unit Price (CHF),Consumed Qty,Cost (CHF),Missing Qty,Shrinkage (CHF)");
  for (const p of data.itemPrices) {
    rows.push(
      `${field(p.itemName)},${p.unitPrice.toFixed(2)},${p.qtyConsumed},${p.cost.toFixed(2)},${p.lossQty},${p.lossCost.toFixed(2)}`
    );
  }
  rows.push("");

  rows.push(
    "User,Consumed Qty,Cost Share (CHF),Of Which Shrinkage (CHF),Amount Paid (CHF),Net Owed (CHF)"
  );
  for (const s of data.shares) {
    rows.push(
      `${field(s.userName)},${s.qty},${s.costShare.toFixed(2)},${s.lossShare.toFixed(2)},${s.amountPaid.toFixed(2)},${s.netOwed.toFixed(2)}`
    );
  }
  rows.push("");

  rows.push("From,To,Amount (CHF)");
  for (const l of data.lines) {
    rows.push(
      `${field(l.fromUserName)},${field(l.toUserName)},${l.amount.toFixed(2)}`,
    );
  }

  return rows.join("\n");
}
