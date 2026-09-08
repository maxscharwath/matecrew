"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OAuthButtons } from "@/components/oauth-buttons";
import { MateCan } from "@/components/mate-can";
import { MATE_LABELS } from "@/lib/mate-label";
import type { OAuthProvider } from "@/lib/oauth-providers";

export function SignInForm({ oauthProviders, allowedDomain, passwordEnabled, redirectTo }: { oauthProviders: OAuthProvider[]; allowedDomain: string | null; passwordEnabled: boolean; redirectTo?: string }) {
  const router = useRouter();
  const t = useTranslations();
  // A different can each visit: whichever label chance hands out.
  const [label] = useState(
    () => MATE_LABELS[Math.floor(Math.random() * MATE_LABELS.length)],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const destination = redirectTo || "/";
    const { error } = await signIn.email({
      email,
      password,
      callbackURL: destination,
    });

    if (error) {
      setError(error.message ?? t('auth.invalidCredentials'));
      setLoading(false);
    } else {
      router.push(destination);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* The can gets its own stage: a strip above the form on phones, the
          whole left half on a laptop. One canvas either way — CSS moves it,
          so the WebGL context is not paid for twice. */}
      <div className="stage-gradient relative h-56 shrink-0 lg:h-auto lg:flex-1">
        <MateCan className="absolute inset-0" label={label} />
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.signInTitle')}</CardTitle>
          <CardDescription>
            {t('auth.signInDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthButtons
            providers={oauthProviders}
            mode="signIn"
            loading={loading}
            onLoadingChange={setLoading}
            redirectTo={redirectTo}
            showSeparator={passwordEnabled}
          />

          {passwordEnabled && (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t('auth.email')}</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder={allowedDomain ? `you@${allowedDomain}` : t('auth.emailPlaceholder')}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">{t('auth.password')}</Label>
                    <Link href="/forgot-password" className="text-sm text-muted-foreground underline">
                      {t('auth.forgotPassword')}
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-500">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t('auth.signingIn') : t('auth.signIn')}
                </Button>
              </form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {t('auth.noAccount')}{" "}
                <Link href={redirectTo ? `/sign-up?redirectTo=${encodeURIComponent(redirectTo)}` : "/sign-up"} className="text-primary underline">
                  {t('auth.createOne')}
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
