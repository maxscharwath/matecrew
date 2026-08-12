"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Check, CheckCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  markAllArticlesReadAction,
  markArticleReadAction,
  markArticleUnreadAction,
} from "@/app/whats-new/actions";

export function MarkAllReadButton() {
  const t = useTranslations();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllArticlesReadAction();
          if (result.success) {
            toast.success(t("whatsNew.allMarkedRead", { count: result.count }));
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <CheckCheck className="h-4 w-4" />
      {t("whatsNew.markAllRead")}
    </Button>
  );
}

/**
 * Marks an article read once it has actually been opened.
 *
 * Done from the client on mount rather than during the page's render: a server
 * component writing to the database on GET would fire on prefetch and on every
 * re-render. The action is idempotent, and the ref guards against React running
 * effects twice in development.
 */
export function MarkReadOnView({
  slug,
  alreadyRead,
}: {
  readonly slug: string;
  readonly alreadyRead: boolean;
}) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (alreadyRead || fired.current) return;
    fired.current = true;
    void markArticleReadAction(slug).then(() => {
      // Refresh so the sidebar badge and the list drop this article.
      router.refresh();
    });
  }, [slug, alreadyRead, router]);

  return null;
}

/** Lets someone put an article back to unread — e.g. to show a colleague. */
export function ReadToggle({
  slug,
  isRead,
}: {
  readonly slug: string;
  readonly isRead: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = isRead
            ? await markArticleUnreadAction(slug)
            : await markArticleReadAction(slug);
          if (result.success) router.refresh();
          else toast.error(result.error);
        })
      }
    >
      {isRead ? (
        <>
          <Undo2 className="h-4 w-4" />
          {t("whatsNew.markUnread")}
        </>
      ) : (
        <>
          <Check className="h-4 w-4" />
          {t("whatsNew.markRead")}
        </>
      )}
    </Button>
  );
}
