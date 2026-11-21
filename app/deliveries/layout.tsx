import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "投递记录" };

export default function DeliveriesLayout({ children }: { children: ReactNode }) {
  return children;
}
