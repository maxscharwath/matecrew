import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  // Release-note articles live as .mdx under content/whats-new, so MDX has to
  // be a recognised page/module extension.
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  // The badge terminal screen is rendered with fonts read from disk at runtime,
  // which file tracing cannot see on its own.
  outputFileTracingIncludes: {
    "/api/device/screen": ["./assets/fonts/**"],
    "/org/[officeId]/admin/devices/[deviceId]/screen": ["./assets/fonts/**"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

const withMDX = createMDX({
  // No remark/rehype plugins: articles are authored in-repo by us, and each one
  // exports its own `meta`, so we need neither frontmatter parsing nor
  // sanitisation of untrusted markdown.
});

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(withMDX(nextConfig));
