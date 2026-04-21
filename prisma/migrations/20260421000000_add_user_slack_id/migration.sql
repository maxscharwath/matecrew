-- AlterTable
ALTER TABLE "User" ADD COLUMN "slackUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_slackUserId_key" ON "User"("slackUserId");
