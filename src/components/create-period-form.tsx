"use client";

import { useTransition, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createReimbursementPeriod } from "@/app/org/[officeId]/admin/reimbursements/actions";

interface CreatePeriodFormProps {
  readonly officeId: string;
}

export function CreatePeriodForm({ officeId }: CreatePeriodFormProps) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createReimbursementPeriod(officeId, formData);
      if (result.success) {
        toast.success("Reimbursement period created");
        formRef.current?.reset();
      } else {
        toast.error(result.error);
      }
    });
  }

  // Default: first day of previous month to last day of previous month
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Period</CardTitle>
        <CardDescription>
          Create a reimbursement period to calculate who owes whom.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="flex items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={prevMonthStart.toISOString().split("T")[0]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">End Date</Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              required
              defaultValue={prevMonthEnd.toISOString().split("T")[0]}
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating..." : "Create Period"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
