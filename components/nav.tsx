"use client";

import { Avatar, Breadcrumbs, Button, Dropdown, Drawer, Label, Link } from "@heroui/react";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type Key, type ReactNode, type Ref } from "react";
import { Brand } from "./brand";
import { Glyph, type IconName } from "./icons";
import { IconButton } from "./primitives";
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
  const path = usePathname();
  const current = navigation.find((item) => item.href === path)?.label ?? "工作空间";
  const { openTask, refresh } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop() { if (desktop.matches) setMobileOpen(false); }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return <div className="app-layout">
    <Link href="#main" className="skip-link">跳转到主要内容</Link>
    <aside className="sidebar">
      <WorkspaceBrand />
      <WorkspaceNavigation />
    </aside>
    <div className="main-layout">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="flex min-w-0 items-center gap-2">
            <div className="mobile-toggle">
              <Drawer isOpen={mobileOpen} onOpenChange={setMobileOpen}>
                <IconButton className="mobile-menu-button" icon="menu" label="打开导航" />
                <Drawer.Backdrop isDismissable>
                  <Drawer.Content placement="left">
                    <Drawer.Dialog className="mobile-nav-dialog gap-4 px-4 pt-3 pb-4 text-foreground">
                      <Drawer.Header className="flex-row items-center justify-between gap-2 ps-2">
                        <Drawer.Heading className="sr-only">工作空间导航</Drawer.Heading>
                        <WorkspaceBrand onNavigate={() => setMobileOpen(false)} />
                        <IconButton icon="close" label="关闭导航" autoFocus onPress={() => setMobileOpen(false)} />
                      </Drawer.Header>
                      <Drawer.Body className="flex flex-col text-foreground"><WorkspaceNavigation onNavigate={() => setMobileOpen(false)} /></Drawer.Body>
                    </Drawer.Dialog>
                  </Drawer.Content>
                </Drawer.Backdrop>
              </Drawer>
            </div>
            <div className="mobile-brand"><WorkspaceBrand /></div>
            <Breadcrumbs className="topbar-location" aria-label="当前位置">
              <Breadcrumbs.Item>{current}</Breadcrumbs.Item>
            </Breadcrumbs>
          </div>
          <div className="topbar-actions flex shrink-0 items-center gap-1.5 sm:gap-2">
            <IconButton className="topbar-refresh" icon="refresh" label="刷新工作空间" onPress={() => void refresh()} />
            <ThemeToggle />
            <IconButton icon="plus" label="新建提醒" variant="primary" onPress={() => openTask()} />
          </div>
        </div>
      </header>
      <main id="main" className="workspace-main" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}

function WorkspaceBrand({ onNavigate }: { onNavigate?: () => void }) {
  return <Link href="/" className="w-fit no-underline hover:no-underline" aria-label="Barker 工作概览"
    render={({ ref, ...props }) => <NextLink {...props} ref={ref as Ref<HTMLAnchorElement>} href="/" onNavigate={onNavigate} />}>
    <Brand />
  </Link>;
}

function WorkspaceNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const { dashboard, logout, notify } = useWorkspace();

  function handleAccountAction(key: Key) {
    onNavigate?.();
    if (key === "settings" && confirmUnsavedNavigation()) router.push("/settings");
    if (key === "logout" && confirmUnsavedNavigation()) void logout().catch((error) => notify(errorMessage(error), "error"));
  }

  return <>
    <nav aria-label="主导航" className="grid gap-1">
      <p className="nav-heading mb-1">工作空间</p>
      {navigation.map((item) => <Link href={item.href} key={item.href} className="nav-item" aria-current={path === item.href ? "page" : undefined}
        render={({ ref, ...props }) => <NextLink {...props} ref={ref as Ref<HTMLAnchorElement>} href={item.href} onNavigate={onNavigate} />}>
        <Glyph name={item.icon} /><span>{item.label}</span>
      </Link>)}
    </nav>
    <div className="mt-auto grid gap-2 pt-8">
      {dashboard?.displayTimeZone && <p className="flex items-center gap-2 px-3 text-xs text-muted" aria-label={`显示时区：${dashboard.displayTimeZone}`}>
        <Glyph name="globe" size={15} />{dashboard.displayTimeZone}
      </p>}
      <Dropdown>
        <Button variant="ghost" fullWidth className="h-auto justify-start gap-2.5 p-2 text-start">
          <Avatar size="sm" color="accent" aria-hidden="true"><Avatar.Fallback>B</Avatar.Fallback></Avatar>
          <span className="flex-1">个人工作空间</span>
          <Glyph name="chevronDown" size={14} className="text-muted" />
        </Button>
        <Dropdown.Popover placement="top start" className="account-popover">
          <Dropdown.Menu aria-label="工作空间账户操作" onAction={handleAccountAction}>
            <Dropdown.Item id="settings" textValue="推送设置"><Glyph name="gear" /><Label>推送设置</Label></Dropdown.Item>
            <Dropdown.Item id="logout" textValue="退出工作空间"><Glyph name="logout" /><Label>退出工作空间</Label></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  </>;
}
