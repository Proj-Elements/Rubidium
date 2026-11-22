import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import type { RecurrencePreset } from "./types";

export const LOCALES = ["zh-CN", "zh-TW", "en"] as const;
export type Locale = typeof LOCALES[number];
export type MessageKey = keyof typeof en;
export type MessageValues = Record<string, string | number>;
export type LocalizedMessage = { key: MessageKey; values?: MessageValues };
export const LOCALE_COOKIE = "rubidium_locale";

export const localeTags: Record<Locale, string> = { "zh-CN": "zh-CN", "zh-TW": "zh-TW", en: "en-US" };
export const localeTables: Record<Locale, Record<MessageKey, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

export const presetMessageKeys: Record<RecurrencePreset, MessageKey> = {
  once: "preset.once",
  daily: "preset.daily",
  weekdays: "preset.weekdays",
  weekly: "preset.weekly",
  monthly: "preset.monthly",
  custom: "preset.custom",
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && Object.hasOwn(en, value);
}

export function inferLocaleFromRequest(input: { savedLocale?: string | null; acceptLanguage?: string | null; ipCountry?: string | null; trustProxy?: boolean }): Locale {
  if (isLocale(input.savedLocale)) return input.savedLocale;
  const country = input.ipCountry?.trim().toUpperCase();
  if (input.trustProxy && country && /^[A-Z]{2}$/.test(country) && !["XX", "ZZ"].includes(country)) {
    if (country === "CN") return "zh-CN";
    if (["TW", "HK", "MO"].includes(country)) return "zh-TW";
    return "en";
  }
  const languages = (input.acceptLanguage ?? "").split(",").map((entry) => {
    const [tag, quality] = entry.trim().split(/;\s*q=/);
    return { tag: tag.toLowerCase(), quality: Number(quality ?? 1) };
  }).filter((language) => language.quality > 0 && language.quality <= 1).sort((left, right) => right.quality - left.quality);
  for (const { tag } of languages) {
    if (tag === "zh-tw" || tag === "zh-hk" || tag === "zh-mo" || tag.startsWith("zh-hant")) return "zh-TW";
    if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "zh-CN";
}

export function translate(locale: Locale, key: MessageKey, values?: MessageValues): string {
  const message = localeTables[locale][key];
  return values ? message.replace(/\{(\w+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token) : message;
}
