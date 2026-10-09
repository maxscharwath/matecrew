"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { approveDeviceLink, denyDeviceLink } from "@/app/link/actions";

interface Props {
  readonly initialCode: string;
  readonly codeIsInvalid: boolean;
  readonly request: { code: string; hardwareId: string; requestedAt: string } | null;
  readonly offices: { id: string; name: string }[];
}

type Done = { kind: "approved"; officeName: string; officeId: string } | { kind: "denied" };

export function DeviceLinkForm({ initialCode, codeIsInvalid, request, offices }: Props) {
  const t = useTranslations("deviceLink");
  const format = useFormatter();
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [officeId, setOfficeId] = useState(offices[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  if (done?.kind === "approved") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-green-600" /> {t("approvedTitle")}
          </CardTitle>
          <CardDescription>{t("approved", { office: done.officeName })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/org/${done.officeId}/admin/devices`}>{t("goToDevices")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (done?.kind === "denied") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <XCircle className="size-5 text-destructive" /> {t("deniedTitle")}
          </CardTitle>
          <CardDescription>{t("denied")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!request) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/link?code=${encodeURIComponent(code.trim())}`);
        }}
      >
        <Label htmlFor="code">{t("codeLabel")}</Label>
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t("codePlaceholder")}
          autoCapitalize="characters"
          autoComplete="off"
          className="h-14 text-center font-mono text-2xl tracking-widest"
        />
        {codeIsInvalid && <p className="text-sm text-destructive">{t("invalidCode")}</p>}
        <Button type="submit" size="lg" disabled={code.trim().length < 8}>
          {t("continue")}
        </Button>
      </form>
    );
  }

  if (offices.length === 0) {
    return <p className="text-destructive">{t("noAdminOffice")}</p>;
  }

  const officeName = offices.find((o) => o.id === officeId)?.name ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("requestTitle")}</CardTitle>
        <CardDescription className="space-y-1">
          <span className="block font-mono text-3xl tracking-widest text-foreground">{request.code}</span>
          <span className="block">{t("hardwareId", { id: request.hardwareId })}</span>
          <span className="block">
            {t("requestedAt", { time: format.dateTime(new Date(request.requestedAt), { timeStyle: "short" }) })}
          </span>
          <span className="block">{t("checkScreen")}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              const result = await approveDeviceLink(formData);
              if (result.success) {
                setDone({ kind: "approved", officeName: result.officeName, officeId: result.officeId });
              } else {
                setError(result.error);
              }
            })
          }
        >
          <input type="hidden" name="code" value={request.code} />
          <div className="flex flex-col gap-2">
            <Label>{t("office")}</Label>
            <Select name="officeId" value={officeId} onValueChange={setOfficeId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {offices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input
              id="name"
              name="name"
              key={officeId}
              defaultValue={t("defaultName", { office: officeName })}
              maxLength={60}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="lg" className="flex-1" disabled={pending}>
              {t("approve")}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await denyDeviceLink(request.code);
                  setDone({ kind: "denied" });
                })
              }
            >
              {t("deny")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
