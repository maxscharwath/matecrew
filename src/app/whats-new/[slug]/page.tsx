import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth-utils";
import type { Locale } from "@/i18n/request";
import { findArticle, loadArticle } from "@/lib/whats-new/articles";
import { getReadSlugs } from "@/lib/whats-new/read-state";
import { articleComponents } from "@/components/whats-new/mdx-widgets";
import {
  MarkReadOnView,
  ReadToggle,
} from "@/components/whats-new/read-controls";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  readonly params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const entry = findArticle(slug);
  if (!entry) return {};

  const locale = (await getLocale()) as Locale;
  const { meta } = await loadArticle(entry, locale);
  return { title: `${meta.title} — MateCrew`, description: meta.summary };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const entry = findArticle(slug);
  if (!entry) notFound();

  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const format = await getFormatter();

  const [{ default: Body, meta }, readSlugs] = await Promise.all([
    loadArticle(entry, locale),
    getReadSlugs(session.user.id),
  ]);
  const isRead = readSlugs.has(slug);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/whats-new"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("whatsNew.backToList")}
      </Link>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-6 space-y-2">
            <time
              dateTime={entry.date}
              className="text-xs text-muted-foreground"
            >
              {format.dateTime(new Date(`${entry.date}T00:00:00Z`), {
                dateStyle: "long",
                timeZone: "UTC",
              })}
            </time>
            <h1 className="text-2xl font-bold">{meta.title}</h1>
            <p className="text-muted-foreground">{meta.summary}</p>
          </div>

          <div className="text-sm">
            {/* Article bodies may use these widgets; nothing else is in scope. */}
            <Body components={articleComponents} />
          </div>

          <div className="mt-8 flex justify-end border-t pt-4">
            <ReadToggle slug={slug} isRead={isRead} />
          </div>
        </CardContent>
      </Card>

      {/* Opening the article is what marks it read. */}
      <MarkReadOnView slug={slug} alreadyRead={isRead} />
    </div>
  );
}
