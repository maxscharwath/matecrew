import { getEnabledOAuthProviders, getFirstAllowedDomain } from "@/lib/oauth-providers";
import { SignInForm } from "@/components/sign-in-form";

export default function SignInPage() {
  const oauthProviders = getEnabledOAuthProviders();
  const allowedDomain = getFirstAllowedDomain();
  return <SignInForm oauthProviders={oauthProviders} allowedDomain={allowedDomain} />;
}
