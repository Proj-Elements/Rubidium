"use client";

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
import { LocaleProvider, useTranslations } from "./locale-provider";
import type { Locale } from "@/lib/i18n";

export function Workspace({ children, initialLocale }: { children: ReactNode; initialLocale: Locale }) {
  return <LocaleProvider locale={initialLocale}><WorkspaceContent>{children}</WorkspaceContent></LocaleProvider>;
}

function WorkspaceContent({ children }: { children: ReactNode }) {
  const { t, locale } = useTranslations();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [setupEnabled, setSetupEnabled] = useState(false);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [error, setError] = useState("");
  async function checkSession() {
    try {
      const data = await api<{ authenticated: boolean; initialized: boolean; setupEnabled: boolean; setupTokenRequired: boolean }>("/api/session");
      setError(""); setAuthenticated(data.authenticated); setInitialized(data.initialized); setSetupEnabled(data.setupEnabled); setSetupTokenRequired(data.setupTokenRequired);
    } catch (error) { setError(errorMessage(error, locale)); }
  }
  useEffect(() => {
    let alive = true;
    void api<{ authenticated: boolean; initialized: boolean; setupEnabled: boolean; setupTokenRequired: boolean }>("/api/session").then((data) => {
      if (alive) { setAuthenticated(data.authenticated); setInitialized(data.initialized); setSetupEnabled(data.setupEnabled); setSetupTokenRequired(data.setupTokenRequired); }
    }).catch((error) => { if (alive) setError(errorMessage(error, locale)); });
    const expired = () => setAuthenticated(false);
    window.addEventListener("barker:unauthorized", expired);
    return () => { alive = false; window.removeEventListener("barker:unauthorized", expired); };
  }, [locale]);
  return <>
    <Toast.Provider placement="top end" />
    {authenticated === null ? <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <span className="brand-mark"><Glyph name="bell" size={22} /></span>
      {error ? <Notice action={<Button variant="ghost" onPress={() => void checkSession()}>{t("common.reconnect")}</Button>}>{error}</Notice> : <Loading>{t("common.openingWorkspace")}</Loading>}
    </main> : !authenticated ? <Gate setup={initialized === false} setupEnabled={setupEnabled} setupTokenRequired={setupTokenRequired} onAuthed={() => setAuthenticated(true)} /> : <AuthenticatedWorkspace logout={async () => { await api("/api/session", { method: "DELETE" }); setAuthenticated(false); }}>{children}</AuthenticatedWorkspace>}
  </>;
}

function AuthenticatedWorkspace({ children, logout }: { children: ReactNode; logout: () => Promise<void> }) {
  const { t } = useTranslations();
  const path = usePathname();
  const { data: dashboard, error, refresh } = useResource<Dashboard>("/api/overview", path === "/" ? 15_000 : 60_000);
  const [editor, setEditor] = useState<{ task?: Task; duplicate?: boolean } | null>(null);
  return <WorkspaceContext.Provider value={{ dashboard, error, refresh, logout, openTask: (task, duplicate) => setEditor({ task, duplicate }), notify: (message, kind = "success") => { if (kind === "error") toast.danger(message); else toast.success(message); } }}>
    <FloatingScrollbar />
    <Shell>
      {error && <div className="mb-6"><Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("common.retry")}</Button>}>
        <p>{dashboard ? t("common.syncUnavailable") : t("common.workspaceUnavailable")}</p><p>{error}</p>
      </Notice></div>}
      {children}
    </Shell>
    {editor && <TaskEditor task={editor.task} duplicate={editor.duplicate} onClose={() => setEditor(null)} />}
    <UnsavedNavigationDialog />
  </WorkspaceContext.Provider>;
}
