"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/auth-utils";

/**
 * Resolves an MCP authorization request the user was shown a consent screen
 * for. Better Auth turns the consent code into an authorization code (on
 * accept) or an `access_denied` error (on deny), and hands back the client
 * redirect we have to follow.
 */
export async function decideOAuthConsent(
  consentCode: string,
  accept: boolean,
): Promise<void> {
  await requireSession();

  let redirectURI: string;
  try {
    const result = await auth.api.oAuthConsent({
      body: { accept, consent_code: consentCode },
      headers: await headers(),
    });
    redirectURI = result.redirectURI;
  } catch {
    // Expired or already-used consent code — there is no client redirect to
    // fall back to, so land the user somewhere they can restart the flow.
    redirect("/oauth/consent?error=expired");
  }

  redirect(redirectURI);
}
