"use client";

import { Button, Link, Sheet, Tooltip } from "@heroui/react";
import { Sidebar, useSidebar } from "@heroui-pro/react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Brand } from "./brand";
import { Glyph, type IconName } from "./icons";
import { Confirm, IconButton, WorkspaceLink } from "./primitives";
import { ThemeToggle } from "./theme-toggle";
import { confirmUnsavedNavigation } from "./use-unsaved";
import { useWorkspace } from "./workspace-context";
import { errorMessage } from "@/lib/ui";
import { useTranslations } from "./locale-provider";
import { LanguageSwitcher } from "./language-switcher";
import type { MessageKey } from "@/lib/i18n";

const navigation: Array<{ href: string; label: MessageKey; icon: IconName }> = [
  { href: "/", label: "nav.overview", icon: "squares" },
  { href: "/tasks", label: "nav.reminders", icon: "calendar" },
  { href: "/deliveries", label: "nav.deliveries", icon: "send" },
  { href: "/settings", label: "nav.settings", icon: "gear" },
];

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useTranslations();
  return <Sidebar.Provider className="app-layout" defaultOpen toggleShortcut="mod+b" reduceMotion
    navigate={(href) => confirmUnsavedNavigation(() => router.push(href))}>
    <Link href="#main" className="skip-link">{t("nav.skipToMain")}</Link>
    <Sidebar><SidebarSections /></Sidebar>
    <Sidebar.Mobile><SidebarSections mobile /></Sidebar.Mobile>
    <Sidebar.Main className="min-w-0">
      <WorkspaceToolbar />
      <div id="main" className="workspace-main" tabIndex={-1}>{children}</div>
    </Sidebar.Main>
  </Sidebar.Provider>;
}

function WorkspaceToolbar() {
  const { openTask, refresh } = useWorkspace();
  const { t } = useTranslations();
  const { isMobile, isMobileOpen, isOpen } = useSidebar();
  const toggleLabel = isMobile ? isMobileOpen ? t("nav.close") : t("nav.open") : isOpen ? t("nav.collapse") : t("nav.expand");
  return <header className="topbar">
    <div className="topbar-inner">
      <Tooltip delay={350}>
        <Sidebar.Trigger aria-label={toggleLabel} className={`${isMobile ? "mobile-toggle" : "desktop-toggle"} size-11`}>
          <Glyph name={isMobile ? "menu" : "chevron"} className={!isMobile && isOpen ? "-rotate-180" : "rotate-0"} />
        </Sidebar.Trigger>
        <Tooltip.Content>{toggleLabel}</Tooltip.Content>
      </Tooltip>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <IconButton className="topbar-refresh" icon="refresh" label={t("nav.refresh")} onPress={() => void refresh()} />
        <ThemeToggle />
        <LanguageSwitcher />
        <Button className="min-h-11 gap-2" onPress={() => openTask()}><Glyph name="plus" />{t("nav.newReminder")}</Button>
      </div>
    </div>
  </header>;
}

function SidebarSections({ mobile = false }: { mobile?: boolean }) {
  const { t, locale } = useTranslations();
  const path = usePathname();
  const { isOpen, setMobileOpen } = useSidebar();
  const { logout, notify } = useWorkspace();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const collapsed = !mobile && !isOpen;
  const footerGap = collapsed ? "gap-1" : mobile ? "gap-2" : "gap-3";
  const close = () => setMobileOpen(false);
  const requestLogout = () => setConfirmLogout(true);

  return <>
    {mobile && <Sheet.Heading className="sr-only">{t("nav.workspaceNavigation")}</Sheet.Heading>}
    <Sidebar.Header className={`flex-row items-center ${collapsed ? "justify-center px-0" : "justify-between px-5"} ${mobile ? "py-3" : "pt-6 pb-8"}`}>
      <WorkspaceLink href="/" className="w-fit no-underline hover:no-underline" aria-label={`Rubidium · ${t("nav.overview")}`} onNavigate={close}><Brand /></WorkspaceLink>
      {mobile && <IconButton icon="close" label={t("nav.close")} onPress={close} />}
    </Sidebar.Header>
    <Sidebar.Content>
      <Sidebar.Group>
        <Sidebar.GroupLabel>{t("nav.workspace")}</Sidebar.GroupLabel>
        <Sidebar.Menu aria-label={t("nav.main")}>
          {navigation.map((item) => <Sidebar.MenuItem key={item.href} id={item.href} href={item.href} isCurrent={path === item.href} textValue={t(item.label)}>
            <Sidebar.MenuIcon><Glyph name={item.icon} /></Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{t(item.label)}</Sidebar.MenuLabel>
          </Sidebar.MenuItem>)}
        </Sidebar.Menu>
      </Sidebar.Group>
    </Sidebar.Content>
    <Sidebar.Footer className={`${footerGap}${collapsed ? " sidebar-footer-collapsed" : ""}`}>
      {collapsed ? <>
        <Tooltip delay={350}>
          <Button isIconOnly variant="danger-soft" aria-label={t("common.signOut")} className="sidebar-compact-action size-11" onPress={requestLogout}>
            <Glyph name="logout" />
          </Button>
          <Tooltip.Content>{t("common.signOut")}</Tooltip.Content>
        </Tooltip>
      </> : <>
        <Button variant="danger-soft" fullWidth className="min-h-11 justify-start gap-2" onPress={requestLogout}>
          <Glyph name="logout" />{t("common.signOut")}
        </Button>
      </>}
    </Sidebar.Footer>
    {confirmLogout && <Confirm title={t("common.signOutTitle")} confirmLabel={t("common.signOut")} onClose={() => setConfirmLogout(false)} onConfirm={() => {
      close();
      setConfirmLogout(false);
      void logout().catch((error) => notify(errorMessage(error, locale), "error"));
    }}><p>{t("common.signOutDescription")}</p></Confirm>}
  </>;
}
