-- ─── Item model + per-item stock/consumption/purchase dimension ─────────────
--
-- Introduces a per-office `Item` (e.g. "Maté Classic", "Maté Zero", "Ginger").
-- Every existing row is backfilled onto a default "Maté Classic" item so the
-- historical single-product data stays intact.

-- 1. Item table
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Item_officeId_name_key" ON "Item"("officeId", "name");
CREATE INDEX "Item_officeId_idx" ON "Item"("officeId");
ALTER TABLE "Item" ADD CONSTRAINT "Item_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Seed one default item per existing office
INSERT INTO "Item" ("id", "officeId", "name", "active", "isDefault", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Maté Classic', true, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Office";

-- 3. Add itemId columns (nullable during backfill)
ALTER TABLE "DailyRequest" ADD COLUMN "itemId" TEXT;
ALTER TABLE "ConsumptionEntry" ADD COLUMN "itemId" TEXT;
ALTER TABLE "PurchaseBatch" ADD COLUMN "itemId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "itemId" TEXT;
ALTER TABLE "Stock" ADD COLUMN "itemId" TEXT;

-- 4. Backfill from each office's default item
UPDATE "DailyRequest" t SET "itemId" = i."id"
    FROM "Item" i WHERE i."officeId" = t."officeId" AND i."isDefault" = true;
UPDATE "ConsumptionEntry" t SET "itemId" = i."id"
    FROM "Item" i WHERE i."officeId" = t."officeId" AND i."isDefault" = true;
UPDATE "PurchaseBatch" t SET "itemId" = i."id"
    FROM "Item" i WHERE i."officeId" = t."officeId" AND i."isDefault" = true;
UPDATE "StockMovement" t SET "itemId" = i."id"
    FROM "Item" i WHERE i."officeId" = t."officeId" AND i."isDefault" = true;
UPDATE "Stock" t SET "itemId" = i."id"
    FROM "Item" i WHERE i."officeId" = t."officeId" AND i."isDefault" = true;

-- 5. Enforce NOT NULL
ALTER TABLE "DailyRequest" ALTER COLUMN "itemId" SET NOT NULL;
ALTER TABLE "ConsumptionEntry" ALTER COLUMN "itemId" SET NOT NULL;
ALTER TABLE "PurchaseBatch" ALTER COLUMN "itemId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "itemId" SET NOT NULL;
ALTER TABLE "Stock" ALTER COLUMN "itemId" SET NOT NULL;

-- 6. Rebuild Stock primary key as composite (officeId, itemId)
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_officeId_fkey";
ALTER TABLE "Stock" DROP CONSTRAINT "Stock_pkey";
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_pkey" PRIMARY KEY ("officeId", "itemId");

-- 7. Indexes for the new item dimension
CREATE INDEX "Stock_itemId_idx" ON "Stock"("itemId");
CREATE INDEX "StockMovement_officeId_itemId_idx" ON "StockMovement"("officeId", "itemId");
CREATE INDEX "DailyRequest_itemId_idx" ON "DailyRequest"("itemId");
CREATE INDEX "ConsumptionEntry_officeId_itemId_idx" ON "ConsumptionEntry"("officeId", "itemId");
CREATE INDEX "PurchaseBatch_itemId_idx" ON "PurchaseBatch"("itemId");

-- 8. Foreign keys for the new relations
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_officeId_itemId_fkey" FOREIGN KEY ("officeId", "itemId") REFERENCES "Stock"("officeId", "itemId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyRequest" ADD CONSTRAINT "DailyRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsumptionEntry" ADD CONSTRAINT "ConsumptionEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseBatch" ADD CONSTRAINT "PurchaseBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
