-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('ORDERED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID');

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_officeId_fkey";

-- AlterTable
ALTER TABLE "PurchaseBatch" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "status" "PurchaseStatus" NOT NULL DEFAULT 'ORDERED';

-- AlterTable
ALTER TABLE "ReimbursementLine" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "ReimbursementPeriod" DROP COLUMN "closedAt",
ADD COLUMN     "month" INTEGER NOT NULL,
ADD COLUMN     "year" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "lowStockAlertSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "officeId",
DROP COLUMN "roles";

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "roles" "Role"[] DEFAULT ARRAY['EMPLOYEE']::"Role"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_officeId_key" ON "Membership"("userId", "officeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReimbursementPeriod_officeId_year_month_key" ON "ReimbursementPeriod"("officeId", "year", "month");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
