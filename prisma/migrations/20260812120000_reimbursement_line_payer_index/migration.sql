-- CreateIndex
CREATE INDEX "ReimbursementLine_fromUserId_status_idx" ON "ReimbursementLine"("fromUserId", "status");
