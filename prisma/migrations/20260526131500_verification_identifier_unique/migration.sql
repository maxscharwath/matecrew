-- Clear any stale verification rows (short-lived tokens; safe to drop)
-- Required because the previous schema allowed duplicate identifiers and
-- Better Auth's deleteVerificationByIdentifier failed without @unique,
-- leaving orphan rows that would collide with the new constraint.
DELETE FROM "Verification";

-- CreateIndex
CREATE UNIQUE INDEX "Verification_identifier_key" ON "Verification"("identifier");
