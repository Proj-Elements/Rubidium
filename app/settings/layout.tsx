import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "推送设置" };

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
