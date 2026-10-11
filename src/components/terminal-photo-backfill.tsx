"use client";

import { useEffect, useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeTerminalPhotos } from "@/app/org/[officeId]/admin/items/actions";

/**
 * Photos without their terminal picture, which only happens to photos stored before pictures
 * were computed at upload: worked out as soon as the page opens, the button retries a failure.
 */
export function TerminalPhotoBackfill({ officeId, count }: Readonly<{ officeId: string; count: number }>) {
  const t = useTranslations("items.terminalImage");
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  const compute = () =>
    startTransition(async () => {
      const { computed, failed } = await computeTerminalPhotos(officeId);
      if (computed > 0) toast.success(t("backfillDone", { count: computed }));
      if (failed > 0) toast.error(t("backfillFailed", { count: failed }));
    });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    compute();
    // Once per page: a re-render must not start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{t("backfillHint", { count })}</p>
      <Button variant="outline" size="sm" className="shrink-0" disabled={pending} onClick={compute}>
        {pending ? <Loader2 className="animate-spin" /> : <ImageDown />} {t("backfill")}
      </Button>
    </div>
  );
}
