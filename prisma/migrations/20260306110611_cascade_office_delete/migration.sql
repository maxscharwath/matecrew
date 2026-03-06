-- AlterTable: User.defaultOfficeId -> SET NULL on delete
ALTER TABLE "User" DROP CONSTRAINT "User_defaultOfficeId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_defaultOfficeId_fkey" FOREIGN KEY ("defaultOfficeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Membership.officeId -> CASCADE on delete
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_officeId_fkey";
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: DailyRequest.officeId -> CASCADE on delete
ALTER TABLE "DailyRequest" DROP CONSTRAINT "DailyRequest_officeId_fkey";
ALTER TABLE "DailyRequest" ADD CONSTRAINT "DailyRequest_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Stock.officeId -> CASCADE on delete
ALTER TABLE "Stock" DROP CONSTRAINT "Stock_officeId_fkey";
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: StockMovement.officeId -> CASCADE on delete
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_officeId_fkey";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Stock"("officeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: PurchaseBatch.officeId -> CASCADE on delete
ALTER TABLE "PurchaseBatch" DROP CONSTRAINT "PurchaseBatch_officeId_fkey";
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: InvoiceFile.purchaseBatchId -> CASCADE on delete
ALTER TABLE "InvoiceFile" DROP CONSTRAINT "InvoiceFile_purchaseBatchId_fkey";
ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_purchaseBatchId_fkey" FOREIGN KEY ("purchaseBatchId") REFERENCES "PurchaseBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: ConsumptionEntry.officeId -> CASCADE on delete
ALTER TABLE "ConsumptionEntry" DROP CONSTRAINT "ConsumptionEntry_officeId_fkey";
ALTER TABLE "ConsumptionEntry" ADD CONSTRAINT "ConsumptionEntry_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: ReimbursementPeriod.officeId -> CASCADE on delete
ALTER TABLE "ReimbursementPeriod" DROP CONSTRAINT "ReimbursementPeriod_officeId_fkey";
ALTER TABLE "ReimbursementPeriod" ADD CONSTRAINT "ReimbursementPeriod_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: ReimbursementLine.periodId -> CASCADE on delete
ALTER TABLE "ReimbursementLine" DROP CONSTRAINT "ReimbursementLine_periodId_fkey";
ALTER TABLE "ReimbursementLine" ADD CONSTRAINT "ReimbursementLine_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReimbursementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
