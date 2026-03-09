-- DropForeignKey
ALTER TABLE "ConsumptionEntry" DROP CONSTRAINT "ConsumptionEntry_officeId_fkey";

-- DropForeignKey
ALTER TABLE "DailyRequest" DROP CONSTRAINT "DailyRequest_officeId_fkey";

-- DropForeignKey
ALTER TABLE "InvoiceFile" DROP CONSTRAINT "InvoiceFile_purchaseBatchId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_officeId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseBatch" DROP CONSTRAINT "PurchaseBatch_officeId_fkey";

-- DropForeignKey
ALTER TABLE "ReimbursementLine" DROP CONSTRAINT "ReimbursementLine_periodId_fkey";

-- DropForeignKey
ALTER TABLE "ReimbursementPeriod" DROP CONSTRAINT "ReimbursementPeriod_officeId_fkey";

-- DropForeignKey
ALTER TABLE "Stock" DROP CONSTRAINT "Stock_officeId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_officeId_fkey";

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRequest" ADD CONSTRAINT "DailyRequest_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Stock"("officeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_purchaseBatchId_fkey" FOREIGN KEY ("purchaseBatchId") REFERENCES "PurchaseBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionEntry" ADD CONSTRAINT "ConsumptionEntry_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementPeriod" ADD CONSTRAINT "ReimbursementPeriod_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementLine" ADD CONSTRAINT "ReimbursementLine_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReimbursementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
