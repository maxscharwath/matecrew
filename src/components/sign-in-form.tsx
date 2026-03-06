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
import type { OAuthProvider } from "@/lib/oauth-providers";

export function SignInForm({ oauthProviders, allowedDomain, redirectTo }: { oauthProviders: OAuthProvider[]; allowedDomain: string | null; redirectTo?: string }) {
  const router = useRouter();
  const t = useTranslations();
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
    <div className="flex min-h-screen items-center justify-center">
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
          />

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
              <Label htmlFor="password">{t('auth.password')}</Label>
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
        </CardContent>
      </Card>
    </div>
  );
}
