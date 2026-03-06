import { getEnabledOAuthProviders, getFirstAllowedDomain } from "@/lib/oauth-providers";
import { SignInForm } from "@/components/sign-in-form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirectTo?: string }> }) {
  const oauthProviders = getEnabledOAuthProviders();
  const allowedDomain = getFirstAllowedDomain();
  const { redirectTo } = await searchParams;
  return <SignInForm oauthProviders={oauthProviders} allowedDomain={allowedDomain} redirectTo={redirectTo} />;
}
