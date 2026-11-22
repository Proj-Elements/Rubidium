"use client";

import { I18nProvider } from "react-aria";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { LOCALE_COOKIE, localeTags, translate, type Locale, type MessageKey, type MessageValues } from "@/lib/i18n";

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: MessageKey, values?: MessageValues) => string };

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const t = useCallback((key: MessageKey, values?: MessageValues) => translate(locale, key, values), [locale]);
  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: (next) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      if (next !== locale) router.refresh();
    },
    t,
  }), [locale, router, t]);

  return <LocaleContext.Provider value={value}>
    <I18nProvider locale={localeTags[locale]}>{children}</I18nProvider>
  </LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context.locale;
}

export function useTranslations() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useTranslations must be used within LocaleProvider");
  return context;
}
