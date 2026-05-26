import { redirect } from "next/navigation";
import { getEnabledOAuthProviders, getFirstAllowedDomain, isPasswordAuthEnabled } from "@/lib/oauth-providers";
import { SignUpForm } from "@/components/sign-up-form";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ redirectTo?: string }> }) {
  const { redirectTo } = await searchParams;
  if (!isPasswordAuthEnabled()) {
    redirect(redirectTo ? `/sign-in?redirectTo=${encodeURIComponent(redirectTo)}` : "/sign-in");
  }
  const oauthProviders = getEnabledOAuthProviders();
  const allowedDomain = getFirstAllowedDomain();
  return (
    <SignUpForm
      oauthProviders={oauthProviders}
      allowedDomain={allowedDomain}
      redirectTo={redirectTo}
    />
  );
}
