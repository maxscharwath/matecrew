"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CupSoda } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { takeACan } from "@/app/org/[officeId]/dashboard/actions";

interface Props {
  officeId: string;
}

export function TakeCanButton({ officeId }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  function handleConfirm() {
    startTransition(async () => {
      const result = await takeACan(officeId);
      setOpen(false);
      if (result.success) {
        toast.success(t("dashboard.canTaken"));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={isPending}
        size="lg"
        className="gap-2"
      >
        <CupSoda className="size-5" />
        {isPending ? t("common.processing") : t("dashboard.takeCan")}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={handleConfirm}
        title={t("dashboard.takeCanConfirmTitle")}
        description={t("dashboard.takeCanConfirmDescription")}
        confirmLabel={t("dashboard.takeCan")}
        confirmVariant="default"
        isPending={isPending}
      />
    </>
  );
}
