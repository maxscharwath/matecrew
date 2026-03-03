"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { switchLocale } from "@/lib/locale";

export function LocaleSync({ userLocale }: { readonly userLocale: string }) {
  const currentLocale = useLocale();
  const router = useRouter();
  const synced = useRef(false);

  useEffect(() => {
    if (!synced.current && userLocale !== currentLocale) {
      synced.current = true;
      switchLocale(userLocale).then(() => {
        router.refresh();
      });
    }
  }, [userLocale, currentLocale, router]);

  return null;
}
