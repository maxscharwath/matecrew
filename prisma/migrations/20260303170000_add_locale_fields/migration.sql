-- AlterTable
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'fr';

-- AlterTable
ALTER TABLE "Office" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'fr';
