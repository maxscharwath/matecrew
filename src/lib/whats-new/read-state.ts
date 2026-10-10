import { commitBatch, prisma, retryOnConflict } from "@/lib/prisma";
import { ARTICLE_SLUGS } from "@/lib/whats-new/articles";

/**
 * Read/unread bookkeeping for release notes.
 *
 * The catalogue is the source of truth for what exists, and the database only
 * records what someone has read. Everything here therefore intersects stored
 * rows with the current `ARTICLE_SLUGS`, so a renamed or removed article can
 * never leave a user with a permanently stuck unread badge.
 */

/** Slugs this user has already read, filtered to articles that still exist. */
export async function getReadSlugs(userId: string): Promise<Set<string>> {
  const rows = await prisma.articleRead.findMany({
    where: { userId, slug: { in: [...ARTICLE_SLUGS] } },
    select: { slug: true },
  });
  return new Set(rows.map((r) => r.slug));
}

export async function countUnread(userId: string): Promise<number> {
  const read = await getReadSlugs(userId);
  return ARTICLE_SLUGS.filter((slug) => !read.has(slug)).length;
}

/**
 * The article to announce: the newest unread one.
 *
 * `ARTICLE_SLUGS` follows the catalogue's newest-first order, so the first
 * unread slug is the most recent. Returns null when everything has been read.
 */
export async function getNewestUnreadSlug(
  userId: string,
): Promise<string | null> {
  const read = await getReadSlugs(userId);
  return ARTICLE_SLUGS.find((slug) => !read.has(slug)) ?? null;
}

/** Idempotent: re-reading an article must not fail or move `readAt`. */
export async function markRead(userId: string, slug: string): Promise<void> {
  if (!ARTICLE_SLUGS.includes(slug)) return;
  await prisma.articleRead.upsert({
    where: { userId_slug: { userId, slug } },
    create: { userId, slug },
    update: {},
  });
}

/**
 * Reads what is already read, then inserts the rest in one batch. A concurrent
 * read of the same article in another tab turns the insert into a unique-key
 * conflict, which rolls it back: read again and insert what is still missing.
 */
export async function markAllRead(userId: string): Promise<number> {
  return retryOnConflict(async () => {
    const read = await getReadSlugs(userId);
    const missing = ARTICLE_SLUGS.filter((slug) => !read.has(slug));
    if (missing.length === 0) return 0;

    const [count] = await commitBatch((db) => [
      db.articleRead.createMany({ data: missing.map((slug) => ({ userId, slug })) }),
    ]);
    return count;
  });
}

export async function markUnread(userId: string, slug: string): Promise<void> {
  await prisma.articleRead.deleteMany({ where: { userId, slug } });
}
