import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ShieldCheck, Wrench, BarChart3, CupSoda } from "lucide-react";
import { getOptionalSession } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { decideOAuthConsent } from "./actions";

interface ConsentSearchParams {
  consent_code?: string;
  client_id?: string;
  scope?: string;
  error?: string;
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<ConsentSearchParams>;
}) {
  const { consent_code: consentCode, client_id: clientId, error } =
    await searchParams;
  const t = await getTranslations();

  if (error || !consentCode || !clientId) {
    return (
      <ConsentShell
        title={t("oauthConsent.expiredTitle")}
        description={t("oauthConsent.expiredBody")}
      />
    );
  }

  const session = await getOptionalSession();
  if (!session) {
    // The authorize endpoint normally signs the user in first; if the session
    // lapsed between the redirect and this render, restart from sign-in.
    redirect("/sign-in");
  }

  const client = await prisma.oauthApplication.findUnique({
    where: { clientId },
    select: { name: true, disabled: true },
  });

  if (!client || client.disabled) {
    return (
      <ConsentShell
        title={t("oauthConsent.unknownClientTitle")}
        description={t("oauthConsent.unknownClientBody")}
      />
    );
  }

  // An MCP token acts as the user, so what it can reach is exactly the user's
  // own access — including admin powers in offices where they are an admin.
  const adminOffices = await prisma.membership.findMany({
    where: { userId: session.user.id, roles: { has: "ADMIN" } },
    select: { office: { select: { name: true } } },
    orderBy: { office: { name: "asc" } },
  });

  const clientName = client.name || t("oauthConsent.unnamedClient");
  const approve = decideOAuthConsent.bind(null, consentCode, true);
  const deny = decideOAuthConsent.bind(null, consentCode, false);

  return (
    <ConsentShell
      title={t("oauthConsent.title", { client: clientName })}
      description={t("oauthConsent.description", {
        client: clientName,
        email: session.user.email,
      })}
    >
      <ul className="space-y-3 text-sm">
        <Grant icon={<CupSoda className="size-4" />}>
          {t("oauthConsent.grantOrders")}
        </Grant>
        <Grant icon={<BarChart3 className="size-4" />}>
          {t("oauthConsent.grantHistory")}
        </Grant>
        <Grant icon={<Wrench className="size-4" />}>
          {t("oauthConsent.grantStock")}
        </Grant>
        {adminOffices.length > 0 && (
          <Grant icon={<ShieldCheck className="size-4" />}>
            {t("oauthConsent.grantAdmin", {
              offices: adminOffices
                .map((m) => m.office.name)
                .join(", "),
            })}
          </Grant>
        )}
      </ul>

      <div className="mt-6 flex gap-3">
        <form action={deny} className="flex-1">
          <Button type="submit" variant="outline" className="w-full">
            {t("oauthConsent.deny")}
          </Button>
        </form>
        <form action={approve} className="flex-1">
          <Button type="submit" className="w-full">
            {t("oauthConsent.approve")}
          </Button>
        </form>
      </div>
    </ConsentShell>
  );
}

function Grant({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function ConsentShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </div>
  );
}
