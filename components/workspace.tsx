"use client";

import { I18nProvider } from "react-aria";
import { usePathname } from "next/navigation";
import { Button, Toast, toast } from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";
import type { Dashboard, Task } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";
import { Gate } from "./gate";
import { Shell } from "./nav";
import { Loading, Notice } from "./primitives";
import { useResource } from "./use-resource";
import { WorkspaceContext } from "./workspace-context";
import { TaskEditor } from "./task-editor";
import { Glyph } from "./icons";
import { UnsavedNavigationDialog } from "./unsaved-navigation-dialog";
import { FloatingScrollbar } from "./floating-scrollbar";

export function Workspace({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [setupEnabled, setSetupEnabled] = useState(false);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [error, setError] = useState("");
  async function checkSession() {
    try {
      const data = await api<{ authenticated: boolean; initialized: boolean; setupEnabled: boolean; setupTokenRequired: boolean }>("/api/session");
      setError(""); setAuthenticated(data.authenticated); setInitialized(data.initialized); setSetupEnabled(data.setupEnabled); setSetupTokenRequired(data.setupTokenRequired);
    } catch (error) { setError(errorMessage(error)); }
  }
  useEffect(() => {
    let alive = true;
    void api<{ authenticated: boolean; initialized: boolean; setupEnabled: boolean; setupTokenRequired: boolean }>("/api/session").then((data) => {
      if (alive) { setAuthenticated(data.authenticated); setInitialized(data.initialized); setSetupEnabled(data.setupEnabled); setSetupTokenRequired(data.setupTokenRequired); }
    }).catch((error) => { if (alive) setError(errorMessage(error)); });
    const expired = () => setAuthenticated(false);
    window.addEventListener("barker:unauthorized", expired);
    return () => { alive = false; window.removeEventListener("barker:unauthorized", expired); };
  }, []);
  return <I18nProvider locale="zh-CN">
    <Toast.Provider placement="top end" />
    {authenticated === null ? <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <span className="brand-mark"><Glyph name="bell" size={22} /></span>
      {error ? <Notice action={<Button variant="ghost" onPress={() => void checkSession()}>重新连接</Button>}>{error}</Notice> : <Loading>正在打开工作空间</Loading>}
    </main> : !authenticated ? <Gate setup={initialized === false} setupEnabled={setupEnabled} setupTokenRequired={setupTokenRequired} onAuthed={() => setAuthenticated(true)} /> : <AuthenticatedWorkspace logout={async () => { await api("/api/session", { method: "DELETE" }); setAuthenticated(false); }}>{children}</AuthenticatedWorkspace>}
  </I18nProvider>;
}

function AuthenticatedWorkspace({ children, logout }: { children: ReactNode; logout: () => Promise<void> }) {
  const path = usePathname();
  const { data: dashboard, error, refresh } = useResource<Dashboard>("/api/overview", path === "/" ? 15_000 : 60_000);
  const [editor, setEditor] = useState<{ task?: Task; duplicate?: boolean } | null>(null);
  return <WorkspaceContext.Provider value={{ dashboard, error, refresh, logout, openTask: (task, duplicate) => setEditor({ task, duplicate }), notify: (message, kind = "success") => { if (kind === "error") toast.danger(message); else toast.success(message); } }}>
    <FloatingScrollbar />
    <Shell>
      {error && <div className="mb-6"><Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>
        <p>{dashboard ? "暂时无法同步，当前显示上次数据。" : "暂时无法读取工作区。"}</p><p>{error}</p>
      </Notice></div>}
      {children}
    </Shell>
    {editor && <TaskEditor task={editor.task} duplicate={editor.duplicate} onClose={() => setEditor(null)} />}
    <UnsavedNavigationDialog />
  </WorkspaceContext.Provider>;
}
