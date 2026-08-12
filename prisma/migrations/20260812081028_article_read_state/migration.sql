-- CreateTable
CREATE TABLE "ArticleRead" (
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleRead_pkey" PRIMARY KEY ("userId","slug")
);

-- CreateIndex
CREATE INDEX "ArticleRead_userId_idx" ON "ArticleRead"("userId");

-- AddForeignKey
ALTER TABLE "ArticleRead" ADD CONSTRAINT "ArticleRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
