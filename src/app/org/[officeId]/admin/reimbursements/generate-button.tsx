"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateMissingPeriods } from "./actions";

interface Props {
  readonly officeId: string;
}

export function GenerateMissingPeriodsButton({ officeId }: Props) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  function handleClick() {
    startTransition(async () => {
      const result = await generateMissingPeriods(officeId);
      if (result.success) {
        if (result.created === 0) {
          toast.info(t('reimbursements.allMonthsUpToDate'));
        } else {
          toast.success(t('reimbursements.generatedPeriods', { count: result.created }));
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button variant="outline" disabled={isPending} onClick={handleClick}>
      <CalendarPlus className="mr-1.5 size-4" />
      {isPending ? t('reimbursements.generating') : t('reimbursements.generateMissingMonths')}
    </Button>
  );
}
