"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { type Locale, locales, defaultLocale } from "@/i18n/request";

const LOCALE_COOKIE = "NEXT_LOCALE";

export async function getLocaleFromCookie(): Promise<Locale> {
  const store = await cookies();
  const val = store.get(LOCALE_COOKIE)?.value;
  return locales.includes(val as Locale) ? (val as Locale) : defaultLocale;
}

export async function setLocaleCookie(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

export async function updateUserLocale(
  userId: string,
  locale: Locale,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { locale },
  });
  await setLocaleCookie(locale);
}

export async function switchLocale(locale: string): Promise<void> {
  if (!locales.includes(locale as Locale)) return;
  await setLocaleCookie(locale as Locale);
}

export async function switchUserLocale(
  userId: string,
  locale: string,
): Promise<void> {
  if (!locales.includes(locale as Locale)) return;
  await updateUserLocale(userId, locale as Locale);
}
