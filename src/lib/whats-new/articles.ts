import type { MDXComponents } from "mdx/types";
import type { Locale } from "@/i18n/request";

/**
 * The release-note catalogue.
 *
 * Articles are content, not data: they live in the repo as MDX so a note can
 * embed real components, and they ship with the deploy that introduced the
 * feature. `date` is the date the feature actually landed on main, so the
 * timeline reflects history rather than when someone got round to writing it up.
 *
 * Registration is explicit rather than a directory scan: a static import graph
 * is what lets the bundler resolve MDX at build time, and it keeps a
 * half-finished draft out of production until it is listed here.
 */

export interface ArticleMeta {
  readonly title: string;
  readonly summary: string;
}

/**
 * What an article's MDX module exports: the compiled body, plus the `meta` the
 * article declares for itself.
 *
 * `@types/mdx` (a hard dependency of `@mdx-js/react`) declares `*.mdx` with only
 * a default export, and a second ambient declaration for the same wildcard
 * collides with it rather than extending it. So the `meta` export is asserted
 * once, in `loadArticle` below, instead of being declared globally.
 */
interface ArticleModule {
  readonly default: (props: {
    components?: MDXComponents;
  }) => React.JSX.Element;
  readonly meta: ArticleMeta;
}

export interface ArticleEntry {
  readonly slug: string;
  /** ISO date (YYYY-MM-DD) the feature shipped. */
  readonly date: string;
  readonly load: Record<Locale, () => Promise<unknown>>;
}

/** Newest first — the order the What's New page displays. */
export const ARTICLES: readonly ArticleEntry[] = [
  {
    slug: "moving-average-and-shrinkage",
    date: "2026-08-13",
    load: {
      en: () => import("@/content/whats-new/moving-average-and-shrinkage/en.mdx"),
      fr: () => import("@/content/whats-new/moving-average-and-shrinkage/fr.mdx"),
    },
  },
  {
    slug: "claude-integration",
    date: "2026-08-11",
    load: {
      en: () => import("@/content/whats-new/claude-integration/en.mdx"),
      fr: () => import("@/content/whats-new/claude-integration/fr.mdx"),
    },
  },
  {
    slug: "per-item-pricing",
    date: "2026-07-21",
    load: {
      en: () => import("@/content/whats-new/per-item-pricing/en.mdx"),
      fr: () => import("@/content/whats-new/per-item-pricing/fr.mdx"),
    },
  },
  {
    slug: "stats-screen",
    date: "2026-07-17",
    load: {
      en: () => import("@/content/whats-new/stats-screen/en.mdx"),
      fr: () => import("@/content/whats-new/stats-screen/fr.mdx"),
    },
  },
  {
    slug: "multi-item",
    date: "2026-07-10",
    load: {
      en: () => import("@/content/whats-new/multi-item/en.mdx"),
      fr: () => import("@/content/whats-new/multi-item/fr.mdx"),
    },
  },
  {
    slug: "slack-ordering",
    date: "2026-04-21",
    load: {
      en: () => import("@/content/whats-new/slack-ordering/en.mdx"),
      fr: () => import("@/content/whats-new/slack-ordering/fr.mdx"),
    },
  },
];

export function findArticle(slug: string): ArticleEntry | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

/** Every slug, for `generateStaticParams` and for read-state bookkeeping. */
export const ARTICLE_SLUGS: readonly string[] = ARTICLES.map((a) => a.slug);

/**
 * Loads one article in the requested locale, falling back to the other if a
 * translation is missing so a partially-translated note still renders.
 */
export async function loadArticle(
  entry: ArticleEntry,
  locale: Locale,
): Promise<ArticleModule> {
  // The single assertion: every article in this registry is required to export
  // `meta`, which the ambient `*.mdx` type cannot express (see ArticleModule).
  try {
    return (await entry.load[locale]()) as ArticleModule;
  } catch {
    const fallback: Locale = locale === "fr" ? "en" : "fr";
    return (await entry.load[fallback]()) as ArticleModule;
  }
}

/** Metadata for every article, newest first. */
export async function listArticles(
  locale: Locale,
): Promise<
  { slug: string; date: string; title: string; summary: string }[]
> {
  return Promise.all(
    ARTICLES.map(async (entry) => {
      const { meta } = await loadArticle(entry, locale);
      return {
        slug: entry.slug,
        date: entry.date,
        title: meta.title,
        summary: meta.summary,
      };
    }),
  );
}
