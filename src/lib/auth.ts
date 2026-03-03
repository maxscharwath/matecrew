import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh if older than 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  // Microsoft Entra ID — uncomment when ready for V2
  // socialProviders: {
  //   microsoft: {
  //     clientId: process.env.MICROSOFT_CLIENT_ID!,
  //     clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
  //     tenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
  //   },
  // },

  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
