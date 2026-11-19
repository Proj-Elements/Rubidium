"use client";

import { Avatar, Breadcrumbs, Button, Chip, Dropdown, Drawer, Label } from "@heroui/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type Key, type ReactNode } from "react";
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
  const { dashboard, error, refresh } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop() { if (desktop.matches) setMobileOpen(false); }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return <div className="app-layout">
    <a href="#main" className="link skip-link">跳转到主要内容</a>
    <aside className="sidebar"><WorkspaceNavigation /></aside>
    <div className="main-layout">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="flex min-w-0 items-center gap-2">
            <div className="mobile-toggle">
              <Drawer isOpen={mobileOpen} onOpenChange={setMobileOpen}>
                <IconButton icon="menu" label="打开导航" />
                <Drawer.Backdrop isDismissable>
                  <Drawer.Content placement="left">
                    <Drawer.Dialog className="mobile-nav-dialog gap-4 px-5 pt-4 pb-5 text-foreground">
                      <Drawer.Header className="flex-row items-center justify-between gap-2">
                        <Drawer.Heading>工作空间导航</Drawer.Heading>
                        <IconButton icon="close" label="关闭导航" autoFocus onPress={() => setMobileOpen(false)} />
                      </Drawer.Header>
                      <Drawer.Body className="flex flex-col text-foreground"><WorkspaceNavigation onNavigate={() => setMobileOpen(false)} /></Drawer.Body>
                    </Drawer.Dialog>
                  </Drawer.Content>
                </Drawer.Backdrop>
              </Drawer>
            </div>
            <Breadcrumbs className="breadcrumb" aria-label="当前位置">
              <Breadcrumbs.Item href="/" className="breadcrumb-root">工作空间</Breadcrumbs.Item>
              <Breadcrumbs.Item>{current}</Breadcrumbs.Item>
            </Breadcrumbs>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <Chip size="sm" variant="soft" color={error ? "warning" : dashboard ? "success" : "default"} role="status" className="sync-status">
              <Chip.Label>{error ? "同步中断" : dashboard ? "已连接" : "正在连接"}</Chip.Label>
            </Chip>
            <span className="hidden text-xs text-muted tabular-nums sm:block">{dashboard?.displayTimeZone ?? "Asia/Shanghai"}</span>
            <ThemeToggle />
            <IconButton icon="refresh" label="刷新工作空间" onPress={() => void refresh()} />
          </div>
        </div>
      </header>
      <main id="main" className="workspace-main" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer">Barker · 按任务时区调度</footer>
    </div>
  </div>;
}

function WorkspaceNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const { dashboard, openTask, logout, notify } = useWorkspace();

  function handleAccountAction(key: Key) {
    onNavigate?.();
    if (key === "settings" && confirmUnsavedNavigation()) router.push("/settings");
    if (key === "logout" && confirmUnsavedNavigation()) void logout().catch((error) => notify(errorMessage(error), "error"));
  }

  return <>
    <Link href="/" className="link brand" onNavigate={onNavigate} aria-label="Barker 工作概览">
      <span className="brand-mark"><Glyph name="bell" size={22} /></span>
      <span>barker<span className="brand-period">.</span></span>
    </Link>
    <Button className="mt-7 mb-6 shrink-0 justify-start" fullWidth variant="outline" onPress={() => { onNavigate?.(); openTask(); }}>
      <Glyph name="plus" />新建提醒
    </Button>
    <p className="mb-2 px-3 text-xs font-medium text-muted">工作空间</p>
    <nav aria-label="主导航" className="grid gap-1">
      {navigation.map((item) => <Link href={item.href} key={item.href} className="link nav-item" aria-current={path === item.href ? "page" : undefined} onNavigate={onNavigate}>
        <Glyph name={item.icon} /><span>{item.label}</span>
        {item.href === "/tasks" && Boolean(dashboard?.stats.active) && <Chip size="sm" variant="soft" className="nav-count" aria-hidden="true"><Chip.Label>{dashboard?.stats.active}</Chip.Label></Chip>}
        {item.href === "/deliveries" && Boolean(dashboard?.deliveries.retrying) && <Chip size="sm" variant="soft" color="warning" className="nav-count" aria-hidden="true"><Chip.Label>{dashboard?.deliveries.retrying}</Chip.Label></Chip>}
      </Link>)}
    </nav>
    <div className="mt-auto pt-8">
      <Dropdown>
        <Button variant="ghost" fullWidth className="h-auto justify-start gap-3 px-2 py-2.5 text-start">
          <Avatar size="sm" color="accent" aria-hidden="true"><Avatar.Fallback>B</Avatar.Fallback></Avatar>
          <span className="flex-1">个人工作空间</span>
          <Glyph name="chevronDown" size={14} className="text-muted" />
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu aria-label="工作空间账户操作" onAction={handleAccountAction}>
            <Dropdown.Item id="settings" textValue="推送设置"><Glyph name="gear" /><Label>推送设置</Label></Dropdown.Item>
            <Dropdown.Item id="logout" textValue="退出工作空间"><Glyph name="logout" /><Label>退出工作空间</Label></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  </>;
}
