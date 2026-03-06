"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Building2, Clock, XCircle, LogIn } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createJoinRequest } from "@/app/org/[officeId]/join/actions";

interface JoinRequestScreenProps {
  readonly officeId: string;
  readonly officeName: string;
  readonly existingRequest: {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
  } | null;
}

export function JoinRequestScreen({
  officeId,
  officeName,
  existingRequest,
}: JoinRequestScreenProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  function handleRequest() {
    startTransition(async () => {
      const result = await createJoinRequest(officeId);
      if (result.success) {
        toast.success(t("joinRequest.requestSent"));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {existingRequest?.status === "PENDING" ? (
              <Clock className="h-6 w-6 text-muted-foreground" />
            ) : existingRequest?.status === "REJECTED" ? (
              <XCircle className="h-6 w-6 text-destructive" />
            ) : (
              <Building2 className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <CardTitle>
            {existingRequest?.status === "PENDING"
              ? t("joinRequest.pendingTitle")
              : existingRequest?.status === "REJECTED"
                ? t("joinRequest.rejectedTitle")
                : t("joinRequest.title", { office: officeName })}
          </CardTitle>
          <CardDescription>
            {existingRequest?.status === "PENDING"
              ? t("joinRequest.pendingDescription", { office: officeName })
              : existingRequest?.status === "REJECTED"
                ? t("joinRequest.rejectedDescription", { office: officeName })
                : t("joinRequest.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {existingRequest?.status === "PENDING" ? (
            <Button variant="outline" asChild>
              <Link href="/">
                {t("joinRequest.goHome")}
              </Link>
            </Button>
          ) : (
            <>
              <Button onClick={handleRequest} disabled={isPending}>
                <LogIn className="mr-2 h-4 w-4" />
                {isPending
                  ? t("joinRequest.requesting")
                  : existingRequest?.status === "REJECTED"
                    ? t("joinRequest.requestAgain")
                    : t("joinRequest.requestToJoin")}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">
                  {t("joinRequest.goHome")}
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
