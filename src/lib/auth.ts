import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { mcp } from "better-auth/plugins";
import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/base-url";
import { sendPasswordResetEmail, sendEmailVerificationEmail } from "@/lib/email";

const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isEmailAllowed(email: string): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && allowedDomains.includes(domain);
}

const passwordAuthEnabled = process.env.DISABLE_PASSWORD_AUTH !== "true";

export const auth = betterAuth({
  // Explicit rather than inferred: the MCP plugin publishes this value as the
  // OAuth `issuer`, and it throws if the option is unset.
  baseURL: getBaseUrl(),

  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isEmailAllowed(user.email)) {
            return false;
          }
          return { data: user };
        },
      },
    },
  },

  emailAndPassword: {
    enabled: passwordAuthEnabled,
    minPasswordLength: 8,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail(user.email, url);
    },
  },

  emailVerification: {
    sendOnSignUp: passwordAuthEnabled,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailVerificationEmail(user.email, url);
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh if older than 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  socialProviders: {
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
      // Microsoft's ID token doesn't include `email_verified`; trust the
      // provider so users don't get a verification email after SSO sign-in.
      mapProfileToUser: () => ({ emailVerified: true }),
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["microsoft"],
    },
  },

  plugins: [
    // Turns MateCrew into an OAuth 2.1 authorization server so MCP clients
    // (Claude Desktop, claude.ai) can connect as the signed-in user. Clients
    // register themselves via RFC 7591 at /api/auth/mcp/register, so there is
    // no client id to provision by hand.
    mcp({
      loginPage: "/sign-in",
      oidcConfig: {
        // Repeated from the option above: `mcp()` forwards its own `loginPage`
        // into the OIDC provider, but the OIDC option type still requires it.
        loginPage: "/sign-in",
        consentPage: "/oauth/consent",
        // An MCP token grants the caller everything the user can do, so PKCE
        // is mandatory and only S256 is accepted (the metadata advertises S256
        // exclusively — `plain` would contradict it).
        requirePKCE: true,
        allowPlainCodeChallengeMethod: false,
      },
    }),
    // Must stay last: it copies Set-Cookie onto the Next.js response, so any
    // plugin that sets cookies has to run before it.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
