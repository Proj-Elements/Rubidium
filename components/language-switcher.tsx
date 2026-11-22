"use client";

import { Button, Dropdown } from "@heroui/react";
import { useTranslations } from "./locale-provider";
import { isLocale, type Locale, type MessageKey } from "@/lib/i18n";

const choices: Array<{ locale: Locale; label: MessageKey }> = [
  { locale: "zh-CN", label: "language.simplifiedChineseNative" },
  { locale: "zh-TW", label: "language.traditionalChineseNative" },
  { locale: "en", label: "language.englishNative" },
];

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslations();
  return <Dropdown>
    <Button type="button" variant="ghost" className="size-11 min-w-11 px-1 text-sm font-semibold" aria-label={t("language.select")}>
      <span aria-hidden="true">文A</span>
    </Button>
    <Dropdown.Popover>
      <Dropdown.Menu aria-label={t("language.select")} onAction={(key) => { if (isLocale(key)) setLocale(key); }}>
        {choices.map(({ locale: choice, label }) => <Dropdown.Item key={choice} id={choice} textValue={t(label)} aria-current={locale === choice ? "true" : undefined}>{t(label)}</Dropdown.Item>)}
      </Dropdown.Menu>
    </Dropdown.Popover>
  </Dropdown>;
}
