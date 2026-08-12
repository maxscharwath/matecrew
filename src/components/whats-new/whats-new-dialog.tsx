"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { markAllArticlesReadAction } from "@/app/whats-new/actions";

/**
 * "Look what's new" announcement.
 *
 * Shown when the user has unread release notes, once per set of unread
 * articles: dismissing marks everything read, so the same dialog cannot greet
 * them again on the next navigation. Nothing is stored client-side — read state
 * lives in the database, so it follows the user across devices.
 */
export function WhatsNewDialog({
  slug,
  title,
  summary,
  unreadCount,
}: {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly unreadCount: number;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(true);

  async function dismiss() {
    setOpen(false);
    await markAllArticlesReadAction();
    router.refresh();
  }

  function readNow() {
    setOpen(false);
    // Opening the article marks that one read; the rest stay unread on the list.
    router.push(`/whats-new/${slug}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing by Escape or the overlay counts as "Later" — and must still
        // clear the unread set, or the dialog reappears on every page change.
        if (!next) void dismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t("whatsNew.dialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {unreadCount > 1
              ? t("whatsNew.dialogSubtitleMany", { count: unreadCount })
              : t("whatsNew.dialogSubtitleOne")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border p-3">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={dismiss}>
            {t("whatsNew.dialogLater")}
          </Button>
          <Button onClick={readNow}>
            {t("whatsNew.dialogRead")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
