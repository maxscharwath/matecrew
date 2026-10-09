-- CreateEnum
CREATE TYPE "DeviceCommandKind" AS ENUM ('KEY', 'BADGE', 'SYNC', 'RESTART', 'FORGET_WIFI');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "polledAt" TIMESTAMP(3),
ADD COLUMN     "watchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "DeviceCommandKind" NOT NULL,
    "arg" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceFrame" (
    "deviceId" TEXT NOT NULL,
    "bits" BYTEA NOT NULL,
    "hash" TEXT NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceFrame_pkey" PRIMARY KEY ("deviceId")
);

-- CreateIndex
CREATE INDEX "DeviceCommand_deviceId_deliveredAt_idx" ON "DeviceCommand"("deviceId", "deliveredAt");

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceFrame" ADD CONSTRAINT "DeviceFrame_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

