"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Check, X, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  approveJoinRequest,
  rejectJoinRequest,
} from "@/app/org/[officeId]/admin/members/actions";

interface PendingRequest {
  id: string;
  userName: string;
  userEmail: string;
  avatarUrl?: string;
  createdAt: string;
}

interface PendingRequestsCardProps {
  readonly officeId: string;
  readonly requests: PendingRequest[];
}

export function PendingRequestsCard({
  officeId,
  requests,
}: PendingRequestsCardProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations();

  if (requests.length === 0) return null;

  function handleApprove(requestId: string) {
    startTransition(async () => {
      const result = await approveJoinRequest(officeId, requestId);
      if (result.success) {
        toast.success(t("joinRequest.approved"));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleReject(requestId: string) {
    startTransition(async () => {
      const result = await rejectJoinRequest(officeId, requestId);
      if (result.success) {
        toast.success(t("joinRequest.rejected"));
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          {t("joinRequest.pendingRequests")}
        </CardTitle>
        <CardDescription>
          {t("joinRequest.pendingRequestsDescription", {
            count: requests.length,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div className="flex items-center gap-3">
                <Avatar size="sm">
                  <AvatarImage src={request.avatarUrl} alt={request.userName} />
                  <AvatarFallback>
                    {request.userName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{request.userName}</p>
                  <p className="text-sm text-muted-foreground">
                    {request.userEmail}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleApprove(request.id)}
                  disabled={isPending}
                >
                  <Check className="mr-1 h-4 w-4" />
                  {t("joinRequest.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(request.id)}
                  disabled={isPending}
                >
                  <X className="mr-1 h-4 w-4" />
                  {t("joinRequest.reject")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
