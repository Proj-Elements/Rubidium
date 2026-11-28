"use client";

import { useEffect, useState } from "react";
import { IconButton } from "./primitives";
import { useTranslations } from "./locale-provider";

const preferenceKey = "rubidium:appearance";
type Appearance = "system" | "light" | "dark";
export function ThemeToggle() {
  const { t } = useTranslations();
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function syncPreference() {
      const saved = localStorage.getItem(preferenceKey);
      const next = saved === "light" || saved === "dark" ? saved : "system";
      document.documentElement.dataset.theme = next;
      setAppearance(next);
    }
    const syncSystem = () => setSystemDark(media.matches);
    syncPreference();
    syncSystem();
    media.addEventListener("change", syncSystem);
    window.addEventListener("storage", syncPreference);
    return () => {
      media.removeEventListener("change", syncSystem);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  function toggle() {
    const next: Appearance = appearance === "system" ? "light" : appearance === "light" ? "dark" : "system";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(preferenceKey, next);
    setAppearance(next);
  }

  const dark = appearance === "dark" || (appearance === "system" && systemDark);
  const nextAppearance = appearance === "system" ? t("theme.light") : appearance === "light" ? t("theme.dark") : t("theme.system");
  return <IconButton icon={appearance === "system" ? "display" : dark ? "moon" : "sun"} label={t("theme.toggle", { current: t(`theme.${appearance}`), next: nextAppearance })} onPress={toggle} />;
}
