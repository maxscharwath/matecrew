import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth-utils";
import { getEnabledOAuthProviders, getFirstAllowedDomain, isPasswordAuthEnabled } from "@/lib/oauth-providers";
import { SignInForm } from "@/components/sign-in-form";

/** Where to send someone who is already signed in: their own relative target, or home. */
function signedInTarget(redirectTo: string | undefined): string {
  return redirectTo?.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirectTo?: string }> }) {
  const oauthProviders = getEnabledOAuthProviders();
  const allowedDomain = getFirstAllowedDomain();
  const passwordEnabled = isPasswordAuthEnabled();
  const { redirectTo } = await searchParams;
  if (await getOptionalSession()) redirect(signedInTarget(redirectTo));
  return (
    <SignInForm
      oauthProviders={oauthProviders}
      allowedDomain={allowedDomain}
      passwordEnabled={passwordEnabled}
      redirectTo={redirectTo}
    />
  );
}
