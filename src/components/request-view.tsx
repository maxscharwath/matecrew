"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  submitDailyRequest,
  cancelDailyRequest,
} from "@/app/org/[officeId]/request/actions";
import { formatDateDisplay } from "@/lib/date";

interface DailyRequest {
  id: string;
  officeId: string;
  status: "REQUESTED" | "SERVED";
}

interface RequestViewProps {
  officeId: string;
  officeName: string;
  date: Date;
  existingRequest: DailyRequest | null;
}

export function RequestView({
  officeId,
  officeName,
  date,
  existingRequest,
}: RequestViewProps) {
  const [isPending, startTransition] = useTransition();

  function handleRequest() {
    startTransition(async () => {
      const result = await submitDailyRequest(officeId, date);
      if (result.success) {
        toast.success("Maté requested!");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleCancel() {
    if (!existingRequest) return;
    startTransition(async () => {
      const result = await cancelDailyRequest(officeId, existingRequest.id);
      if (result.success) {
        toast.success("Request cancelled");
      } else {
        toast.error(result.error);
      }
    });
  }

  // State C: served
  if (existingRequest?.status === "SERVED") {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-xl">
            Maté servi !
          </CardTitle>
          <CardDescription>
            {officeName} — {formatDateDisplay(date)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
          <p className="mt-4 text-muted-foreground">
            Your maté has been marked as served. Enjoy!
          </p>
        </CardContent>
      </Card>
    );
  }

  // State B: requested, can cancel
  if (existingRequest?.status === "REQUESTED") {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-xl">
            Maté demandé
          </CardTitle>
          <CardDescription>
            {officeName} — {formatDateDisplay(date)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
            <span className="text-4xl">🧉</span>
          </div>
          <p className="text-muted-foreground">
            Your request is registered. A runner will prepare your maté.
          </p>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={handleCancel}
          >
            <X className="mr-2 h-4 w-4" />
            {isPending ? "Cancelling..." : "Cancel Request"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // State A: no request, show big button
  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle className="text-xl">Maté du jour</CardTitle>
        <CardDescription>
          {officeName} — {formatDateDisplay(date)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground">
          Want a maté today? Click the button below to request one.
        </p>
        <Button
          size="lg"
          className="h-16 w-full text-lg"
          disabled={isPending}
          onClick={handleRequest}
        >
          {isPending ? "Requesting..." : "Je veux un maté !"}
        </Button>
      </CardContent>
    </Card>
  );
}
