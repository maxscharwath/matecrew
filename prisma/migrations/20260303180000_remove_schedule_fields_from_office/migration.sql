-- AlterTable: remove legacy schedule fields (replaced by MateSession schedule system)
ALTER TABLE "Office" DROP COLUMN IF EXISTS "dailyPostTime";
ALTER TABLE "Office" DROP COLUMN IF EXISTS "requestCutoffTime";

-- Update lowStockThreshold default from 5 to 30
ALTER TABLE "Office" ALTER COLUMN "lowStockThreshold" SET DEFAULT 30;
