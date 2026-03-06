"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

const LABELS: Record<string, string> = {
  dashboard: "nav.dashboard",
  request: "nav.request",
  runner: "nav.runner",
  reimbursements: "nav.reimbursements",
  members: "nav.members",
  schedule: "nav.schedule",
  cron: "nav.cronJobs",
  stock: "nav.stock",
  purchases: "nav.purchases",
  settings: "nav.settings",
  profile: "profile.title",
  create: "office.createOffice",
};

export function NavBreadcrumb() {
  const pathname = usePathname();
  const t = useTranslations();

  // Get the last meaningful segment (skip "org", officeId, "admin")
  const segments = pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  const label = last && LABELS[last];

  if (!label) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>{t(label)}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
