"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn, signUp } from "@/lib/auth-client";
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

export function SignUpForm({ oauthProviders, allowedDomain }: { oauthProviders: OAuthProvider[]; allowedDomain: string | null }) {
  const router = useRouter();
  const t = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { error } = await signUp.email({
      name,
      email,
      password,
      callbackURL: "/",
    });

    if (error) {
      setError(error.message ?? t('auth.signUpFailed'));
      setLoading(false);
    } else {
      router.push("/");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.signUpTitle')}</CardTitle>
          <CardDescription>
            {t('auth.signUpDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthButtons
            providers={oauthProviders}
            mode="signUp"
            loading={loading}
            onLoadingChange={setLoading}
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('auth.name')}</Label>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder={t('auth.namePlaceholder')}
                required
              />
            </div>
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
                minLength={8}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.creatingAccount') : t('auth.signUp')}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t('auth.alreadyHaveAccount')}{" "}
            <Link href="/sign-in" className="text-primary underline">
              {t('auth.signIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
