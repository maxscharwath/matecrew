import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth-utils";
import type { Locale } from "@/i18n/request";
import { listArticles } from "@/lib/whats-new/articles";
import { getReadSlugs } from "@/lib/whats-new/read-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarkAllReadButton } from "@/components/whats-new/read-controls";

export default async function WhatsNewPage() {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const format = await getFormatter();

  const [articles, readSlugs] = await Promise.all([
    listArticles(locale),
    getReadSlugs(session.user.id),
  ]);

  const unreadCount = articles.filter((a) => !readSlugs.has(a.slug)).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("whatsNew.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("whatsNew.subtitle")}</p>
        </div>
        {unreadCount > 0 && <MarkAllReadButton />}
      </div>

      <ol className="space-y-4">
        {articles.map((article) => {
          const isUnread = !readSlugs.has(article.slug);
          return (
            <li key={article.slug}>
              <Card
                id={article.slug}
                className="scroll-mt-20 transition-colors hover:border-foreground/20"
              >
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <time
                      dateTime={article.date}
                      className="text-xs text-muted-foreground"
                    >
                      {/* Parsed as UTC midnight so the displayed day cannot
                          drift backwards in negative-offset timezones. */}
                      {format.dateTime(new Date(`${article.date}T00:00:00Z`), {
                        dateStyle: "long",
                        timeZone: "UTC",
                      })}
                    </time>
                    {isUnread && (
                      <Badge className="gap-1">
                        <Sparkles className="h-3 w-3" />
                        {t("whatsNew.new")}
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="text-lg">
                    <Link
                      href={`/whats-new/${article.slug}`}
                      className="hover:underline"
                    >
                      {article.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>{article.summary}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/whats-new/${article.slug}`}
                    className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                  >
                    {t("whatsNew.readMore")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
