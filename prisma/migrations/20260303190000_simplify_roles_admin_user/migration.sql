-- Add missing defaultOfficeId column to User table
ALTER TABLE "User" ADD COLUMN "defaultOfficeId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_defaultOfficeId_fkey" FOREIGN KEY ("defaultOfficeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum: add USER, migrate data, remove EMPLOYEE and RUNNER
ALTER TYPE "Role" ADD VALUE 'USER';

-- Migrate existing data: EMPLOYEE and RUNNER → USER
UPDATE "Membership"
SET "roles" = array_remove("roles", 'EMPLOYEE'::"Role") || ARRAY['USER']::"Role"[]
WHERE 'EMPLOYEE' = ANY("roles");

UPDATE "Membership"
SET "roles" = array_remove("roles", 'RUNNER'::"Role")
WHERE 'RUNNER' = ANY("roles");

-- Ensure all memberships have at least USER role
UPDATE "Membership"
SET "roles" = "roles" || ARRAY['USER']::"Role"[]
WHERE NOT ('USER' = ANY("roles"));

-- Remove duplicates from roles arrays
UPDATE "Membership"
SET "roles" = (SELECT ARRAY(SELECT DISTINCT unnest("roles")))
WHERE array_length("roles", 1) > (SELECT count(DISTINCT e) FROM unnest("roles") e);

-- Update default value
ALTER TABLE "Membership" ALTER COLUMN "roles" SET DEFAULT ARRAY['USER']::"Role"[];

-- PostgreSQL does not support removing values from an existing enum directly.
-- We need to recreate the enum type.
-- Step 1: Create the new enum
CREATE TYPE "Role_new" AS ENUM ('USER', 'ADMIN');

-- Step 2: Update the column to use the new enum
ALTER TABLE "Membership" ALTER COLUMN "roles" DROP DEFAULT;
ALTER TABLE "Membership" ALTER COLUMN "roles" TYPE "Role_new"[] USING ("roles"::text[]::"Role_new"[]);

-- Step 3: Drop old enum and rename new one
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- Step 4: Restore default
ALTER TABLE "Membership" ALTER COLUMN "roles" SET DEFAULT ARRAY['USER']::"Role"[];
