"use client";

import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { OAuthProvider } from "@/lib/oauth-providers";

const providerIcons: Record<string, React.ReactNode> = {
  microsoft: (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  ),
};

export function OAuthButtons({
  providers,
  mode,
  loading,
  onLoadingChange,
  redirectTo,
}: {
  providers: OAuthProvider[];
  mode: "signIn" | "signUp";
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
  redirectTo?: string;
}) {
  const t = useTranslations();

  if (providers.length === 0) return null;

  const labelKey = mode === "signIn" ? "auth.signInWith" : "auth.signUpWith";

  return (
    <>
      {providers.map((provider) => (
        <Button
          key={provider.id}
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={() => {
            onLoadingChange(true);
            signIn.social({
              provider: provider.id as "microsoft",
              callbackURL: redirectTo || "/",
            });
          }}
        >
          {providerIcons[provider.id]}
          {t(labelKey, { provider: provider.name })}
        </Button>
      ))}

      <div className="relative my-4">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
          {t("common.or")}
        </span>
      </div>
    </>
  );
}
