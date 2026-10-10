import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth-utils";
import { getEnabledOAuthProviders, getFirstAllowedDomain, isPasswordAuthEnabled } from "@/lib/oauth-providers";
import { SignUpForm } from "@/components/sign-up-form";

/** Where to send someone who is already signed in: their own relative target, or home. */
function signedInTarget(redirectTo: string | undefined): string {
  return redirectTo?.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/";
}

export default async function SignUpPage({ searchParams }: Readonly<{ searchParams: Promise<{ redirectTo?: string }> }>) {
  const { redirectTo } = await searchParams;
  if (await getOptionalSession()) redirect(signedInTarget(redirectTo));
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
