"use client";

import { useEffect, useState } from "react";
import { IconButton } from "./primitives";

const preferenceKey = "barker:appearance";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function sync() {
      const saved = localStorage.getItem(preferenceKey);
      const theme = saved === "light" || saved === "dark" ? saved : "system";
      document.documentElement.dataset.theme = theme;
      setDark(theme === "dark" || (theme === "system" && media.matches));
    }
    sync();
    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function toggle() {
    const next = !dark;
    const theme = next ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(preferenceKey, theme);
    setDark(next);
  }

  return <IconButton icon={dark ? "sun" : "moon"} label={dark ? "切换到浅色外观" : "切换到深色外观"} onPress={toggle} />;
}
