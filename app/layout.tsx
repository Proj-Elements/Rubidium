import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Workspace } from "@/components/workspace";
import { getRequestLocale } from "@/lib/locale-server";
import { localeTags, translate } from "@/lib/i18n";
import "@fontsource-variable/manrope";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: { default: `${translate(locale, "nav.overview")} - Rubidium`, template: "%s - Rubidium" },
    description: translate(locale, "app.description"),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const locale = await getRequestLocale();
  return <html lang={localeTags[locale]} data-theme="system"><body className="bg-background text-foreground"><Workspace initialLocale={locale}>{children}</Workspace></body></html>;
}
