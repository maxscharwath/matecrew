-- CreateTable
CREATE TABLE "StatementDelivery" (
    "periodId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementDelivery_pkey" PRIMARY KEY ("periodId","userId")
);

-- CreateIndex
CREATE INDEX "StatementDelivery_periodId_idx" ON "StatementDelivery"("periodId");

-- AddForeignKey
ALTER TABLE "StatementDelivery" ADD CONSTRAINT "StatementDelivery_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReimbursementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementDelivery" ADD CONSTRAINT "StatementDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
