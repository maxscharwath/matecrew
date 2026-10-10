import type { AppEnv, EnvName } from "../ports/env";

const LOCAL_ORIGIN = "http://localhost:3000";

/**
 * `AppEnv` over `process.env`. Node reads `.env.local` into it; Cloudflare's
 * `nodejs_compat` copies the Worker's vars and secrets into it; Azure App
 * Service exposes App Settings the same way.
 */
export function createProcessEnv(): AppEnv {
  function get(name: EnvName): string | undefined {
    const value = process.env[name];
    return value === "" ? undefined : value;
  }

  return {
    get,
    require(name) {
      const value = get(name);
      if (value === undefined) throw new Error(`Missing environment variable ${name}`);
      return value;
    },
    baseUrl() {
      let origin = get("BETTER_AUTH_URL") ?? get("NEXT_PUBLIC_APP_URL") ?? LOCAL_ORIGIN;
      while (origin.endsWith("/")) origin = origin.slice(0, -1);
      return origin;
    },
  };
}
