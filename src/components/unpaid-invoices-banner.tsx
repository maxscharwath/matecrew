import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUnpaidDebts, totalsByCurrency } from "@/lib/unpaid-reimbursements";

/// Permanent, non-dismissible warning about reimbursement lines the user still
/// owes. Renders nothing when there is nothing pending, so it can sit in the
/// shell on every signed-in page.
export async function UnpaidInvoicesBanner({ userId }: { readonly userId: string }) {
  const debts = await getUnpaidDebts(userId);

  if (debts.length === 0) return null;

  const t = await getTranslations("reimbursements");

  const totals = [...totalsByCurrency(debts)]
    .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
    .join(" + ");

  // One button per office, not per debt row — an office with two currencies
  // would otherwise get two identical links.
  const offices = [...new Map(debts.map((d) => [d.officeId, d])).values()];
  const single = offices.length === 1;

  return (
    <div
      role="alert"
      // text-xs on phones: the banner is pinned, so every extra wrapped line
      // is permanently stolen from the viewport.
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 sm:text-sm dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <ReceiptText className="size-4 shrink-0" />
      <span className="flex-1">
        <span className="font-medium">{t("unpaidBannerTitle")}</span>{" "}
        {single
          ? t("unpaidBannerOne", {
              amount: totals,
              office: offices[0].officeName,
            })
          : t("unpaidBannerMany", {
              amount: totals,
              count: offices.length,
            })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {offices.map((debt) => (
          <Button
            key={debt.officeId}
            asChild
            variant="outline"
            size="sm"
            className="h-7 border-red-300 bg-transparent text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900"
          >
            <Link
              href={`/org/${debt.officeId}/reimbursements#pending-payments`}
            >
              {single
                ? t("unpaidBannerSettle")
                : t("unpaidBannerSettleOffice", { office: debt.officeName })}
            </Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
