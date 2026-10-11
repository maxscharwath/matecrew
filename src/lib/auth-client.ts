"use client";

import { createAuthClient } from "better-auth/react";

// No baseURL: Better Auth calls the page's own origin, whichever host serves it.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, requestPasswordReset, resetPassword, sendVerificationEmail } = authClient;
