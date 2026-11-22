import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getRequestLocale } from "@/lib/locale-server";
import { translate } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(await getRequestLocale(), "page.settings") };
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
