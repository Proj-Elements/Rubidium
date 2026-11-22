"use client";

import { clockTime, formatTime, SCHEDULE_TIME_ZONE } from "@/lib/ui";
import { useWorkspace } from "./workspace-context";
import { useLocale } from "./locale-provider";

export function useTime() {
  const { dashboard } = useWorkspace();
  const locale = useLocale();
  const timeZone = dashboard?.displayTimeZone ?? SCHEDULE_TIME_ZONE;
  return {
    timeZone,
    formatTime: (value: string | null, options?: Intl.DateTimeFormatOptions) => formatTime(value, { timeZone, ...options }, locale),
    clockTime: (value: string) => clockTime(value, timeZone, locale),
  };
}
