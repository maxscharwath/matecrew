-- CreateTable
CREATE TABLE "FlipScore" (
    "userId" TEXT NOT NULL,
    "landings" INTEGER NOT NULL DEFAULT 0,
    "throws" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlipScore_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "FlipScore_landings_bestStreak_idx" ON "FlipScore"("landings", "bestStreak");

-- AddForeignKey
ALTER TABLE "FlipScore" ADD CONSTRAINT "FlipScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
