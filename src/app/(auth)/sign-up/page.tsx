import { getEnabledOAuthProviders, getFirstAllowedDomain } from "@/lib/oauth-providers";
import { SignUpForm } from "@/components/sign-up-form";

export default function SignUpPage() {
  const oauthProviders = getEnabledOAuthProviders();
  const allowedDomain = getFirstAllowedDomain();
  return <SignUpForm oauthProviders={oauthProviders} allowedDomain={allowedDomain} />;
}
