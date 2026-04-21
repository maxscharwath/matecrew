import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { verifySlackLinkToken } from "@/lib/slack-link-token";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { confirmSlackLink } from "./actions";

export default async function SlackLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations();

  if (!token) {
    return (
      <ErrorCard
        title={t("slackLink.invalidTitle")}
        body={t("slackLink.missingToken")}
      />
    );
  }

  const session = await getOptionalSession();
  if (!session) {
    const redirectTo = `/slack/link?token=${encodeURIComponent(token)}`;
    redirect(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const payload = verifySlackLinkToken(token);
  if (!payload) {
    return (
      <ErrorCard
        title={t("slackLink.invalidTitle")}
        body={t("slackLink.invalidBody")}
      />
    );
  }

  const [current, owner] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { slackUserId: true, email: true },
    }),
    prisma.user.findUnique({
      where: { slackUserId: payload.slackUserId },
      select: { id: true, email: true },
    }),
  ]);

  if (owner && owner.id !== session.user.id) {
    return (
      <ErrorCard
        title={t("slackLink.takenTitle")}
        body={t("slackLink.takenBody")}
      />
    );
  }

  if (
    current?.slackUserId &&
    current.slackUserId !== payload.slackUserId
  ) {
    return (
      <ErrorCard
        title={t("slackLink.alreadyLinkedTitle")}
        body={t("slackLink.alreadyLinkedBody")}
      />
    );
  }

  const linkWithToken = confirmSlackLink.bind(null, token);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("slackLink.confirmTitle")}</CardTitle>
          <CardDescription>
            {t("slackLink.confirmBody", {
              email: current?.email ?? "",
              slackUser:
                payload.slackUsername || `@${payload.slackUserId}`,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={linkWithToken}>
            <Button type="submit" className="w-full">
              {t("slackLink.confirmButton")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
