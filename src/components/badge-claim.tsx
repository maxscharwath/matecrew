"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Clock, Nfc, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { claimBadge } from "@/app/badge/actions";
import type { ClaimParams } from "@/lib/device/badge-claim";

type Context = { uid: string; office: string; device: string };

interface Props {
  readonly params: ClaimParams;
  readonly state:
    | { kind: "invalid" }
    | { kind: "expired" }
    | ({ kind: "notMember" } & Context)
    | ({ kind: "yours" } & Context)
    | ({ kind: "taken"; holder: string } & Context)
    | ({ kind: "claimable" } & Context);
}

export function BadgeClaim({ params, state }: Props) {
  const t = useTranslations("badgeClaim");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) return <Outcome icon="ok" title={t("doneTitle")} detail={t("done", { device: done })} />;
  switch (state.kind) {
    case "invalid":
      return <Outcome icon="error" title={t("invalidTitle")} detail={t("tapAgain")} />;
    case "expired":
      return <Outcome icon="expired" title={t("expiredTitle")} detail={t("tapAgain")} />;
    case "notMember":
      return <Outcome icon="error" title={t("notMember", { office: state.office })} detail={t("notMemberHint")} />;
    case "yours":
      return <Outcome icon="ok" title={t("yoursTitle")} detail={t("yours", { device: state.device })} />;
    case "taken":
      return <Outcome icon="error" title={t("takenTitle")} detail={t("taken", { holder: state.holder, office: state.office })} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Nfc className="size-5" /> {t("claimTitle")}
        </CardTitle>
        <CardDescription>{t("claim", { device: state.device, office: state.office })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="font-mono text-sm text-muted-foreground">{state.uid}</div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          className="w-full"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await claimBadge(params);
              if (result.success) setDone(result.deviceName);
              else setError(result.error);
            })
          }
        >
          {t("claimButton")}
        </Button>
      </CardContent>
    </Card>
  );
}

function Outcome({ icon, title, detail }: Readonly<{ icon: "ok" | "error" | "expired"; title: string; detail: string }>) {
  const Icon = { ok: CheckCircle2, error: XCircle, expired: Clock }[icon];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className={icon === "ok" ? "size-5 text-green-600" : "size-5 text-muted-foreground"} /> {title}
        </CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}
