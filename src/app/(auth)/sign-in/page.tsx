import { getEnabledOAuthProviders, getFirstAllowedDomain, isPasswordAuthEnabled } from "@/lib/oauth-providers";
import { SignInForm } from "@/components/sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirectTo?: string }> }) {
  const oauthProviders = getEnabledOAuthProviders();
  const allowedDomain = getFirstAllowedDomain();
  const passwordEnabled = isPasswordAuthEnabled();
  const { redirectTo } = await searchParams;
  return (
    <SignInForm
      oauthProviders={oauthProviders}
      allowedDomain={allowedDomain}
      passwordEnabled={passwordEnabled}
      redirectTo={redirectTo}
    />
  );
}
