"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cancelStockCount } from "@/app/org/[officeId]/admin/stock/actions";

interface CancelCountButtonProps {
  readonly officeId: string;
  readonly countId: string;
  /** Cans the count moved, so the dialog can say what comes back. */
  readonly gapCans: number;
}

/**
 * Undoes a count. Behind a confirmation because it moves money: the cans come
 * back to the shelf and their shrinkage stops being billed to the period.
 */
export function CancelCountButton({
  officeId,
  countId,
  gapCans,
}: CancelCountButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelStockCount(officeId, countId);
      if (result.success) {
        toast.success(t("stock.countCancelled", { count: result.restored }));
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={t("stock.cancelCount")}
        title={t("stock.cancelCount")}
        onClick={() => setOpen(true)}
      >
        <Undo2 className="size-4" />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={confirm}
        title={t("stock.cancelCountTitle")}
        description={t("stock.cancelCountDescription", { count: gapCans })}
        confirmLabel={t("stock.cancelCount")}
        isPending={isPending}
      />
    </>
  );
}
