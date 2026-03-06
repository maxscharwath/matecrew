import { getEnabledOAuthProviders, getFirstAllowedDomain } from "@/lib/oauth-providers";
import { SignUpForm } from "@/components/sign-up-form";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ redirectTo?: string }> }) {
  const oauthProviders = getEnabledOAuthProviders();
  const allowedDomain = getFirstAllowedDomain();
  const { redirectTo } = await searchParams;
  return <SignUpForm oauthProviders={oauthProviders} allowedDomain={allowedDomain} redirectTo={redirectTo} />;
}
