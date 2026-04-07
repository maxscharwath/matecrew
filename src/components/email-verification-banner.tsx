"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MailWarning } from "lucide-react";
import { sendVerificationEmail } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function EmailVerificationBanner({ email }: { email: string }) {
  const t = useTranslations("auth");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleResend() {
    setLoading(true);
    await sendVerificationEmail({ email, callbackURL: "/" });
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-3 border-b bg-yellow-50 px-4 py-2 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
      <MailWarning className="size-4 shrink-0" />
      <span className="flex-1">
        {sent ? t("verificationEmailSent") : t("verifyEmailBanner")}
      </span>
      {!sent && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 border-yellow-400 bg-transparent text-yellow-800 hover:bg-yellow-100 dark:border-yellow-600 dark:text-yellow-200 dark:hover:bg-yellow-900"
          onClick={handleResend}
          disabled={loading}
        >
          {loading ? t("sendingVerification") : t("resendVerification")}
        </Button>
      )}
    </div>
  );
}
