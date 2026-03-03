"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { markServed, markUnserved } from "@/app/org/[officeId]/runner/actions";
import { formatDateDisplay } from "@/lib/date";

interface DailyRequest {
  id: string;
  status: "REQUESTED" | "SERVED";
  user: { id: string; name: string; email: string };
}

interface RunnerViewProps {
  readonly requests: DailyRequest[];
  readonly date: Date;
  readonly officeId: string;
}

export function RunnerView({ requests, date, officeId }: RunnerViewProps) {
  const [isPending, startTransition] = useTransition();

  const served = requests.filter((r) => r.status === "SERVED").length;
  const total = requests.length;

  function handleToggle(request: DailyRequest) {
    startTransition(async () => {
      const result =
        request.status === "REQUESTED"
          ? await markServed(officeId, request.id)
          : await markUnserved(officeId, request.id);

      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Runner View</h1>
          <p className="text-muted-foreground">{formatDateDisplay(date)}</p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {served}/{total} servis
        </Badge>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No requests for today.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <Card key={request.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div>
                  <CardTitle className="text-base">
                    {request.user.name}
                  </CardTitle>
                  <CardDescription>{request.user.email}</CardDescription>
                </div>
                <Button
                  variant={
                    request.status === "SERVED" ? "secondary" : "default"
                  }
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleToggle(request)}
                >
                  {request.status === "SERVED" ? (
                    <>
                      <Undo2 className="mr-1 h-4 w-4" />
                      Undo
                    </>
                  ) : (
                    <>
                      <Check className="mr-1 h-4 w-4" />
                      Serve
                    </>
                  )}
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
