import type { ConsumptionShare, ItemPrice, PaymentLine } from "@/lib/reimbursement-calc";
import { toISODateString } from "@/lib/date";

export function generateReimbursementCsv(data: {
  officeName: string;
  startDate: Date;
  endDate: Date;
  totalConsumption: number;
  totalCost: number;
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
  rows.push(`Total cost: CHF ${data.totalCost.toFixed(2)}`);
  rows.push("");

  rows.push("Item,Unit Price (CHF),Consumed Qty,Cost (CHF)");
  for (const p of data.itemPrices) {
    rows.push(
      `"${p.itemName}",${p.unitPrice.toFixed(2)},${p.qtyConsumed},${p.cost.toFixed(2)}`
    );
  }
  rows.push("");

  rows.push("User,Consumed Qty,Cost Share (CHF),Amount Paid (CHF),Net Owed (CHF)");
  for (const s of data.shares) {
    rows.push(
      `"${s.userName}",${s.qty},${s.costShare.toFixed(2)},${s.amountPaid.toFixed(2)},${s.netOwed.toFixed(2)}`
    );
  }
  rows.push("");

  rows.push("From,To,Amount (CHF)");
  for (const l of data.lines) {
    rows.push(`"${l.fromUserName}","${l.toUserName}",${l.amount.toFixed(2)}`);
  }

  return rows.join("\n");
}
