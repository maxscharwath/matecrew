import "server-only";
import { platform, type EnvName } from "@/platform";

export type OAuthProvider = {
  id: string;
  name: string;
  icon: string;
};

const providerConfigs: Record<string, { envKeys: EnvName[]; name: string; icon: string }> = {
  microsoft: {
    envKeys: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    name: "Microsoft",
    icon: "microsoft",
  },
  // Add more providers here, e.g.:
  // google: {
  //   envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  //   name: "Google",
  //   icon: "google",
  // },
};

export function getEnabledOAuthProviders(): OAuthProvider[] {
  return Object.entries(providerConfigs)
    .filter(([, config]) => config.envKeys.every((key) => platform.env.get(key) !== undefined))
    .map(([id, config]) => ({ id, name: config.name, icon: config.icon }));
}

export function getFirstAllowedDomain(): string | null {
  const raw = platform.env.get("ALLOWED_EMAIL_DOMAINS") ?? "";
  const first = raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)[0];
  return first ?? null;
}

export function isPasswordAuthEnabled(): boolean {
  return platform.env.get("DISABLE_PASSWORD_AUTH") !== "true";
}
