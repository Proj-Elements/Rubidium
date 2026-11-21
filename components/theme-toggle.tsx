"use client";

import { useEffect, useState } from "react";
import { IconButton } from "./primitives";

const preferenceKey = "barker:appearance";
type Appearance = "system" | "light" | "dark";
const labels: Record<Appearance, string> = { system: "跟随系统", light: "浅色", dark: "深色" };

export function ThemeToggle() {
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
  const nextAppearance = appearance === "system" ? "浅色" : appearance === "light" ? "深色" : "跟随系统";
  return <IconButton icon={appearance === "system" ? "display" : dark ? "moon" : "sun"} label={`外观：${labels[appearance]}，切换为${nextAppearance}`} onPress={toggle} />;
}
