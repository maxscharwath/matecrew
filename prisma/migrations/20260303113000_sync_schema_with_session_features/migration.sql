-- Ensure Role enum supports membership defaults in current schema.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'USER';

-- Add newly introduced enums when missing.
DO $$
BEGIN
  CREATE TYPE "StockMovementReason" AS ENUM ('SERVED', 'UNSERVED', 'ADJUSTMENT', 'PURCHASE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PurchaseStatus" AS ENUM ('ORDERED', 'DELIVERED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- User / Office shape updates.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS "defaultOfficeId" TEXT;

ALTER TABLE "Office"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'fr';

ALTER TABLE "Office"
  ALTER COLUMN "lowStockThreshold" SET DEFAULT 30;

-- New membership model.
CREATE TABLE IF NOT EXISTS "Membership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "roles" "Role"[] DEFAULT ARRAY['USER']::"Role"[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Membership_userId_officeId_key"
  ON "Membership"("userId", "officeId");

-- Session scheduling model.
CREATE TABLE IF NOT EXISTS "MateSession" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "cutoffTime" TEXT NOT NULL,
  "label" TEXT,
  "lastNotifiedDate" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MateSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MateSession_dayOfWeek_idx" ON "MateSession"("dayOfWeek");
CREATE UNIQUE INDEX IF NOT EXISTS "MateSession_officeId_dayOfWeek_startTime_key"
  ON "MateSession"("officeId", "dayOfWeek", "startTime");

-- Daily requests now point to a mate session.
ALTER TABLE "DailyRequest"
  ADD COLUMN IF NOT EXISTS "mateSessionId" TEXT;

DROP INDEX IF EXISTS "DailyRequest_date_officeId_userId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DailyRequest_date_officeId_userId_mateSessionId_key"
  ON "DailyRequest"("date", "officeId", "userId", "mateSessionId");

-- Stock tracking improvements.
ALTER TABLE "Stock"
  ADD COLUMN IF NOT EXISTS "lowStockAlertSentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "StockMovement" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" "StockMovementReason" NOT NULL,
  "note" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- Purchase and reimbursement state extensions.
ALTER TABLE "PurchaseBatch"
  ADD COLUMN IF NOT EXISTS "status" "PurchaseStatus" NOT NULL DEFAULT 'ORDERED',
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

ALTER TABLE "ReimbursementPeriod"
  ADD COLUMN IF NOT EXISTS "month" INTEGER,
  ADD COLUMN IF NOT EXISTS "year" INTEGER;

UPDATE "ReimbursementPeriod"
SET
  "month" = COALESCE("month", EXTRACT(MONTH FROM "startDate")::INTEGER),
  "year" = COALESCE("year", EXTRACT(YEAR FROM "startDate")::INTEGER)
WHERE "month" IS NULL OR "year" IS NULL;

ALTER TABLE "ReimbursementPeriod"
  ALTER COLUMN "month" SET NOT NULL,
  ALTER COLUMN "year" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ReimbursementPeriod_officeId_year_month_key"
  ON "ReimbursementPeriod"("officeId", "year", "month");

ALTER TABLE "ReimbursementLine"
  ADD COLUMN IF NOT EXISTS "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);

-- Foreign keys created idempotently.
DO $$
BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_defaultOfficeId_fkey"
    FOREIGN KEY ("defaultOfficeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Membership" ADD CONSTRAINT "Membership_officeId_fkey"
    FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MateSession" ADD CONSTRAINT "MateSession_officeId_fkey"
    FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DailyRequest" ADD CONSTRAINT "DailyRequest_mateSessionId_fkey"
    FOREIGN KEY ("mateSessionId") REFERENCES "MateSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_officeId_fkey"
    FOREIGN KEY ("officeId") REFERENCES "Stock"("officeId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
