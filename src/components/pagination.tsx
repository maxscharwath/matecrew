"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";

interface DataPaginationProps {
  readonly totalItems: number;
  readonly pageSize: number;
  readonly pageParam?: string;
}

export function DataPagination({
  totalItems,
  pageSize,
  pageParam = "page",
}: DataPaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("pagination");

  const currentPage = Math.max(1, Number(searchParams.get(pageParam)) || 1);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (totalPages <= 1) return null;

  function buildHref(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) {
      params.delete(pageParam);
    } else {
      params.set(pageParam, String(page));
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function handleNav(page: number, e: React.MouseEvent) {
    e.preventDefault();
    router.push(buildHref(page));
  }

  // Build visible page numbers: always show first, last, current, and neighbors
  const pages: (number | "ellipsis")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - 1 && i <= currentPage + 1)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {t("showing", {
          from: (currentPage - 1) * pageSize + 1,
          to: Math.min(currentPage * pageSize, totalItems),
          total: totalItems,
        })}
      </p>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href={buildHref(currentPage - 1)}
              onClick={(e) => handleNav(currentPage - 1, e)}
              aria-disabled={currentPage <= 1}
              className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
              label={t("previous")}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <PaginationItem key={`e${i}`}>
                <PaginationEllipsis label={t("morePages")} />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href={buildHref(p)}
                  onClick={(e) => handleNav(p, e)}
                  isActive={p === currentPage}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              href={buildHref(currentPage + 1)}
              onClick={(e) => handleNav(currentPage + 1, e)}
              aria-disabled={currentPage >= totalPages}
              className={currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}
              label={t("next")}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
