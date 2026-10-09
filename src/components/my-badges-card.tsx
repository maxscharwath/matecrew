"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Nfc } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { unlinkMyBadge } from "@/app/profile/actions";

interface Props {
  /** `lastPass` is formatted on the server, so the markup matches on hydration. */
  readonly badges: { id: string; uid: string; office: string; lastPass: string }[];
}

/** The member's own badges, and how to link one: tap it on a terminal, scan the QR. */
export function MyBadgesCard({ badges }: Props) {
  const t = useTranslations("profile.badges");
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Nfc className="size-5" /> {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      {badges.length > 0 && (
        <CardContent>
          <ul className="divide-y">
            {badges.map((badge) => (
              <li key={badge.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="text-sm">{t("lastPass", { office: badge.office, when: badge.lastPass })}</div>
                  <div className="font-mono text-xs text-muted-foreground">{badge.uid}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await unlinkMyBadge(badge.id);
                      if (result.success) toast.success(t("unlinked"));
                    })
                  }
                >
                  {t("unlink")}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
