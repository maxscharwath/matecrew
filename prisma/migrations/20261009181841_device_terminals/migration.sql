-- AlterEnum
ALTER TYPE "ConsumptionSource" ADD VALUE IF NOT EXISTS 'DEVICE';

-- CreateEnum
CREATE TYPE "DeviceKeyAction" AS ENUM ('TAKE', 'RETURN');

-- AlterTable
ALTER TABLE "ConsumptionEntry" ADD COLUMN     "deviceId" TEXT;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hardwareId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "linkedById" TEXT,
    "leftAction" "DeviceKeyAction" NOT NULL DEFAULT 'TAKE',
    "leftItemId" TEXT,
    "leftLabel" TEXT,
    "rightAction" "DeviceKeyAction" NOT NULL DEFAULT 'RETURN',
    "rightItemId" TEXT,
    "rightLabel" TEXT,
    "syncTimes" TEXT[] DEFAULT ARRAY['08:00', '12:00', '15:00', '18:00']::TEXT[],
    "firmwareVersion" TEXT,
    "batteryMv" INTEGER,
    "wifiRssi" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceTake" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "takeId" TEXT NOT NULL,
    "action" "DeviceKeyAction" NOT NULL,
    "badgeUid" TEXT NOT NULL,
    "itemId" TEXT,
    "rejectedReason" TEXT,
    "consumptionEntryId" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceTake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLink" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "hardwareId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "officeId" TEXT,
    "deviceName" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "userId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_officeId_idx" ON "Device"("officeId");

-- CreateIndex
CREATE INDEX "DeviceTake_deviceId_takenAt_idx" ON "DeviceTake"("deviceId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceTake_deviceId_takeId_key" ON "DeviceTake"("deviceId", "takeId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_deviceCodeHash_key" ON "DeviceLink"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_userCode_key" ON "DeviceLink"("userCode");

-- CreateIndex
CREATE INDEX "DeviceLink_expiresAt_idx" ON "DeviceLink"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_officeId_uid_key" ON "Badge"("officeId", "uid");

-- AddForeignKey
ALTER TABLE "ConsumptionEntry" ADD CONSTRAINT "ConsumptionEntry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_leftItemId_fkey" FOREIGN KEY ("leftItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_rightItemId_fkey" FOREIGN KEY ("rightItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTake" ADD CONSTRAINT "DeviceTake_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTake" ADD CONSTRAINT "DeviceTake_consumptionEntryId_fkey" FOREIGN KEY ("consumptionEntryId") REFERENCES "ConsumptionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

