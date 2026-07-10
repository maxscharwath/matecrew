-- ─── Multi-item purchase orders ─────────────────────────────────────────────
--
-- A PurchaseBatch becomes an order that can hold several item lines. The
-- per-item (itemId, qty, unitPrice) moves to a new PurchaseLine; each existing
-- batch is migrated into a single line.

-- 1. PurchaseLine table
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "lineTotal" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseLine_batchId_idx" ON "PurchaseLine"("batchId");
CREATE INDEX "PurchaseLine_itemId_idx" ON "PurchaseLine"("itemId");
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Migrate each existing batch into one line
INSERT INTO "PurchaseLine" ("id", "batchId", "itemId", "qty", "unitPrice", "lineTotal")
SELECT gen_random_uuid()::text, "id", "itemId", "qty", "unitPrice", "totalPrice"
FROM "PurchaseBatch";

-- 3. Drop the now-migrated per-item columns from PurchaseBatch
DROP INDEX "PurchaseBatch_itemId_idx";
ALTER TABLE "PurchaseBatch" DROP CONSTRAINT "PurchaseBatch_itemId_fkey";
ALTER TABLE "PurchaseBatch" DROP COLUMN "itemId";
ALTER TABLE "PurchaseBatch" DROP COLUMN "qty";
ALTER TABLE "PurchaseBatch" DROP COLUMN "unitPrice";
