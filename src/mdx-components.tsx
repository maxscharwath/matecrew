import type { MDXComponents } from "mdx/types";
import Link from "next/link";

/**
 * Element mapping for every MDX article.
 *
 * Release notes are plain prose plus the occasional component, and the app has
 * no typography plugin, so headings/lists/code get their styling here rather
 * than each article carrying classes. Article-specific components are passed
 * per-render instead of being registered globally.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: (props) => (
      <h2 className="mt-8 mb-3 text-lg font-semibold first:mt-0" {...props} />
    ),
    h3: (props) => (
      <h3 className="mt-6 mb-2 text-base font-semibold" {...props} />
    ),
    p: (props) => <p className="mb-4 leading-relaxed" {...props} />,
    ul: (props) => (
      <ul className="mb-4 ml-5 list-disc space-y-1.5" {...props} />
    ),
    ol: (props) => (
      <ol className="mb-4 ml-5 list-decimal space-y-1.5" {...props} />
    ),
    li: (props) => <li className="leading-relaxed" {...props} />,
    strong: (props) => <strong className="font-semibold" {...props} />,
    code: (props) => (
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
        {...props}
      />
    ),
    pre: (props) => (
      <pre
        className="mb-4 overflow-x-auto rounded-md bg-muted p-3 text-xs"
        {...props}
      />
    ),
    blockquote: (props) => (
      <blockquote
        className="mb-4 border-l-2 pl-4 text-muted-foreground italic"
        {...props}
      />
    ),
    hr: () => <hr className="my-6" />,
    // Internal links must not full-page reload; external ones open safely.
    a: ({ href = "", ...props }) =>
      href.startsWith("/") ? (
        <Link href={href} className="underline underline-offset-2" {...props} />
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
          {...props}
        />
      ),
    ...components,
  };
}
