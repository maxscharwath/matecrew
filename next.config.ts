import { resolve } from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";
import createMDX from "@next/mdx";

/**
 * The platform adapter set compiled into this build (src/platform/README.md).
 * Chosen here, at build time, so a Cloudflare bundle never contains Node-only
 * code and a Node bundle never contains Cloudflare bindings.
 */
const PLATFORMS = ["node", "cloudflare", "vercel"] as const;
type PlatformName = (typeof PLATFORMS)[number];

function selectedPlatform(): PlatformName {
  // Vercel's build sets VERCEL, so it compiles the vercel set with no project setting.
  const name = process.env.PLATFORM ?? (process.env.VERCEL ? "vercel" : "node");
  const known = PLATFORMS.find((platform) => platform === name);
  if (!known) throw new Error(`Unknown PLATFORM "${name}", expected one of: ${PLATFORMS.join(", ")}`);
  return known;
}

const platform = selectedPlatform();
const platformEntry = `./src/platform/${platform}/index.ts`;

/**
 * Hosts a browser may post server actions from besides the request's own: the public origin
 * (NEXT_PUBLIC_APP_URL) when a proxy fronts this deployment, as matecrew.vercel.app fronts the
 * Cloudflare Worker during the transition (docs/cloudflare-migration.md).
 */
function publicHosts(): string[] {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  return url ? [new URL(url).host] : [];
}

const nextConfig: NextConfig = {
  // Release-note articles live as .mdx under content/whats-new, so MDX has to
  // be a recognised page/module extension.
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  // The device SDK is a TypeScript workspace package (icons, board emulation).
  transpilePackages: ["@matecrew/device-ui"],
  turbopack: {
    resolveAlias: { "@/platform/active": platformEntry },
  },
  webpack(config: { resolve: { alias: Record<string, string> } }) {
    config.resolve.alias["@/platform/active"] = resolve(platformEntry);
    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: publicHosts(),
    },
    // `import app from "….dui" with { type: "bytes" }`: the device apps ship
    // inside the server bundle (src/app/api/device/ui/route.ts).
    turbopackImportTypeBytes: true,
  },
};

const withMDX = createMDX({
  // No remark/rehype plugins: articles are authored in-repo by us, and each one
  // exports its own `meta`, so we need neither frontmatter parsing nor
  // sanitisation of untrusted markdown.
});

const withNextIntl = createNextIntlPlugin();

export default async function config(phase: string): Promise<NextConfig> {
  // `PLATFORM=cloudflare next dev` serves the bindings (D1, R2, Queue
  // producer) from wrangler's local simulation, as declared in wrangler.jsonc.
  // Imported only then: other platforms' builds never load the adapter.
  if (phase === PHASE_DEVELOPMENT_SERVER && platform === "cloudflare") {
    const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");
    void initOpenNextCloudflareForDev();
  }
  return withNextIntl(withMDX(nextConfig));
}
