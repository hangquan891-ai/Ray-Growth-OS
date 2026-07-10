"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { LOCALE_STORAGE_KEY, normalizeLocale, translate, type AppLocale, type TranslationKey } from "@/lib/i18n";

type LanguageContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("zh-CN");
  const hasUserSelectedLocale = useRef(false);

  useEffect(() => {
    if (hasUserSelectedLocale.current) return;
    try {
      setLocaleState(normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY)));
    } catch {
      // Keep the Chinese default when localStorage is unavailable.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    const normalized = normalizeLocale(nextLocale);
    hasUserSelectedLocale.current = true;
    setLocaleState(normalized);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // The language still works for this session if localStorage is blocked.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t: (key) => translate(locale, key) }),
    [locale, setLocale]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useI18n must be used inside LanguageProvider.");
  return context;
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className={`inline-flex h-9 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 ${className}`} role="group" aria-label={t("switchLanguage")}>
      <button
        type="button"
        onClick={() => setLocale("zh-CN")}
        aria-pressed={locale === "zh-CN"}
        className={`rounded-md px-2.5 text-xs font-bold transition-colors ${locale === "zh-CN" ? "bg-white/[0.1] text-white" : "text-white/45 hover:text-white/75"}`}
      >
        中文
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
        className={`rounded-md px-2.5 text-xs font-bold transition-colors ${locale === "en" ? "bg-white/[0.1] text-white" : "text-white/45 hover:text-white/75"}`}
      >
        EN
      </button>
    </div>
  );
}
