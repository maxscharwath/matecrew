import { getLocale } from "next-intl/server";
import { getOptionalSession } from "@/lib/auth-utils";
import type { Locale } from "@/i18n/request";
import { findArticle, loadArticle } from "@/lib/whats-new/articles";
import {
  countUnread,
  getNewestUnreadSlug,
} from "@/lib/whats-new/read-state";
import { WhatsNewDialog } from "@/components/whats-new/whats-new-dialog";

/**
 * Decides whether to announce release notes, and renders nothing when there is
 * nothing to say.
 *
 * A server component so the unread lookup happens during the page render the
 * user already waited for, rather than as a client round-trip on every
 * navigation. Mounted from the sidebar shell, so it covers every signed-in page.
 */
export async function WhatsNewAnnouncer() {
  const session = await getOptionalSession();
  if (!session) return null;

  const slug = await getNewestUnreadSlug(session.user.id);
  if (!slug) return null;

  const entry = findArticle(slug);
  if (!entry) return null;

  const locale = (await getLocale()) as Locale;
  const [{ meta }, unreadCount] = await Promise.all([
    loadArticle(entry, locale),
    countUnread(session.user.id),
  ]);

  return (
    <WhatsNewDialog
      slug={slug}
      title={meta.title}
      summary={meta.summary}
      unreadCount={unreadCount}
    />
  );
}
