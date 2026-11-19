"use client";

import { Avatar, Breadcrumbs, Button, Dropdown, Drawer, Label } from "@heroui/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type Key, type ReactNode } from "react";
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
  const { dashboard, error, refresh, openTask } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

  return <div className="app-layout">
    <a href="#main" className="skip-link">跳转到主要内容</a>
    <aside className="sidebar"><WorkspaceNavigation /></aside>
    <div className="main-layout">
      <header className="topbar">
        <div className="breadcrumb-heading">
          <span className="mobile-toggle"><IconButton icon="menu" label="打开导航" onPress={() => setMobileOpen(true)} /></span>
          <Breadcrumbs className="breadcrumb" separator={<Glyph name="chevron" size={13} />}>
            <Breadcrumbs.Item href="/" className="breadcrumb-root">工作空间</Breadcrumbs.Item>
            <Breadcrumbs.Item className="breadcrumb-current">{current}</Breadcrumbs.Item>
          </Breadcrumbs>
        </div>
        <div className="topbar-trailing">
          <span className={`sync-status ${error ? "offline" : ""}`} role="status" aria-live="polite">
            <span className="status-dot" />{error ? "同步中断" : dashboard ? "自动同步中" : "正在连接"}
          </span>
          <span className="timezone">{dashboard?.displayTimeZone ?? "Asia/Shanghai"}</span>
          <ThemeToggle />
          <IconButton icon="refresh" label="刷新工作空间" onPress={() => void refresh()} />
        </div>
      </header>
      <main id="main" className="workspace-main">{children}</main>
      <footer className="workspace-footer"><span>留给生活更多从容。</span><span>Barker <span className="footer-dot" /> 按任务时区调度</span></footer>
    </div>
    <Drawer.Backdrop isOpen={mobileOpen} onOpenChange={setMobileOpen} isDismissable>
      <Drawer.Content className="mobile-nav-drawer" placement="left">
        <Drawer.Dialog className="mobile-nav-dialog">
          <Drawer.Header className="mobile-nav-heading">
            <Drawer.Heading>你的工作空间</Drawer.Heading>
            <IconButton icon="close" label="关闭导航" onPress={() => setMobileOpen(false)} />
          </Drawer.Header>
          <Drawer.Body className="mobile-nav-content"><WorkspaceNavigation onNavigate={() => setMobileOpen(false)} /></Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
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
    <Link href="/" className="brand" onClick={onNavigate} aria-label="Barker 工作概览">
      <span className="brand-mark"><Glyph name="bell" size={22} /></span>
      <span>barker<span className="brand-period">.</span></span>
    </Link>
    <Button className="sidebar-create" variant="outline" onPress={() => { onNavigate?.(); openTask(); }}>
      <Glyph name="plus" />新建提醒
    </Button>
    <p className="nav-section">我的工作空间</p>
    <nav aria-label="主导航">
      {navigation.map((item) => <Link href={item.href} key={item.href} className={`nav-item ${path === item.href ? "selected" : ""}`} aria-current={path === item.href ? "page" : undefined} onClick={onNavigate}>
        <Glyph name={item.icon} /><span>{item.label}</span>
        {item.href === "/tasks" && Boolean(dashboard?.stats.active) && <span className="nav-count">{dashboard?.stats.active}</span>}
        {item.href === "/deliveries" && Boolean(dashboard?.deliveries.retrying) && <span className="nav-count caution">{dashboard?.deliveries.retrying}</span>}
      </Link>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="sidebar-note"><Glyph name="shield" size={22} /><h3>每条提醒都有记录</h3><p>到期消息持久保存，自动重试。<br />查看投递状态，安心安排。</p></div>
      <Dropdown>
        <Button variant="ghost" className="account-button">
          <Avatar size="sm" color="accent" aria-hidden="true"><Avatar.Fallback>B</Avatar.Fallback></Avatar>
          <span className="account-label">个人工作空间<small>私密安全，随时可访问</small></span>
          <Glyph name="chevronDown" size={14} />
        </Button>
        <Dropdown.Popover className="account-menu">
          <Dropdown.Menu aria-label="工作空间账户操作" onAction={handleAccountAction}>
            <Dropdown.Item id="settings" textValue="推送设置"><Glyph name="gear" /><Label>推送设置</Label></Dropdown.Item>
            <Dropdown.Item id="logout" textValue="退出工作空间"><Glyph name="logout" /><Label>退出工作空间</Label></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  </>;
}
