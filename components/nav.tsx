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

const navigation: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "工作概览", icon: "squares" },
  { href: "/tasks", label: "所有提醒", icon: "calendar" },
  { href: "/deliveries", label: "投递记录", icon: "send" },
  { href: "/settings", label: "推送设置", icon: "gear" },
];

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  return <Sidebar.Provider className="app-layout" open toggleShortcut={false} reduceMotion
    navigate={(href) => confirmUnsavedNavigation(() => router.push(href))}>
    <Link href="#main" className="skip-link">跳转到主要内容</Link>
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
  return <header className="topbar">
    <div className="topbar-inner">
      <Tooltip delay={350}>
        <Sidebar.Trigger aria-label="打开导航" className="mobile-toggle size-11"><Glyph name="menu" /></Sidebar.Trigger>
        <Tooltip.Content>打开导航</Tooltip.Content>
      </Tooltip>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <IconButton className="topbar-refresh" icon="refresh" label="刷新工作空间" onPress={() => void refresh()} />
        <ThemeToggle />
        <Button className="min-h-11 gap-2" onPress={() => openTask()}><Glyph name="plus" />新建提醒</Button>
      </div>
    </div>
  </header>;
}

function SidebarSections({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  const { setMobileOpen } = useSidebar();
  const { dashboard, logout, notify } = useWorkspace();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const close = () => setMobileOpen(false);

  return <>
    {mobile && <Sheet.Heading className="sr-only">工作空间导航</Sheet.Heading>}
    <Sidebar.Header className="flex-row items-center justify-between px-5 pt-6 pb-8">
      <WorkspaceLink href="/" className="w-fit no-underline hover:no-underline" aria-label="Rubidium 工作概览" onNavigate={close}><Brand /></WorkspaceLink>
      {mobile && <IconButton icon="close" label="关闭导航" onPress={close} />}
    </Sidebar.Header>
    <Sidebar.Content>
      <Sidebar.Group>
        <Sidebar.GroupLabel>工作空间</Sidebar.GroupLabel>
        <Sidebar.Menu aria-label="主导航">
          {navigation.map((item) => <Sidebar.MenuItem key={item.href} id={item.href} href={item.href} isCurrent={path === item.href} textValue={item.label}>
            <Sidebar.MenuIcon><Glyph name={item.icon} /></Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
          </Sidebar.MenuItem>)}
        </Sidebar.Menu>
      </Sidebar.Group>
    </Sidebar.Content>
    <Sidebar.Footer className="gap-3">
      {dashboard?.displayTimeZone && <p className="flex items-center gap-2 px-3 text-xs text-muted" aria-label={`显示时区：${dashboard.displayTimeZone}`}>
        <Glyph name="globe" size={15} />{dashboard.displayTimeZone}
      </p>}
      <Button variant="danger-soft" fullWidth className="min-h-11 justify-start gap-2" onPress={() => setConfirmLogout(true)}>
        <Glyph name="logout" />退出登录
      </Button>
    </Sidebar.Footer>
    {confirmLogout && <Confirm title="退出 Rubidium？" confirmLabel="退出登录" onClose={() => setConfirmLogout(false)} onConfirm={() => {
      close();
      setConfirmLogout(false);
      void logout().catch((error) => notify(errorMessage(error), "error"));
    }}><p>当前浏览器会话将结束，尚未保存的表单修改会丢失。其他已登录会话不会受到影响。</p></Confirm>}
  </>;
}
