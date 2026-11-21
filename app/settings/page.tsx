"use client";

import { Button, Card, Form, Tabs } from "@heroui/react";
import { useEffect, useState, type FormEvent } from "react";
import { CardHeading, Confirm, Details, Field, Loading, Notice, PageHeading } from "@/components/primitives";
import { useUnsaved } from "@/components/use-unsaved";
import { useResource } from "@/components/use-resource";
import { useWorkspace } from "@/components/workspace-context";
import { ChannelManager } from "@/components/channel-manager";
import { AuditLog, SecurityManager } from "@/components/security-manager";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { DataTransfer } from "@/components/data-transfer";
import type { BarkSettings } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";

type SettingsPayload = { settings: Omit<BarkSettings, "deviceKey">; deviceKeyConfigured: boolean; revision: number };

export default function SettingsPage() {
  const [activePanel, setActivePanel] = useState("channels");
  const { data, error, refresh } = useResource<SettingsPayload>("/api/settings", 15_000, activePanel === "channels");
  const panel = "grid min-w-0 gap-4 p-0 data-[inert]:hidden";

  return <div className="@container/settings grid gap-6">
    <PageHeading title="推送设置" />
    {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
    <Tabs className="settings-tabs min-w-0 gap-5" defaultSelectedKey="channels" onSelectionChange={(key) => setActivePanel(String(key))}>
      <Tabs.ListContainer className="w-full min-w-0 self-start sm:w-fit">
        <Tabs.List className="grid w-full grid-cols-3 whitespace-nowrap sm:flex [&>[role=tab]]:min-h-11" aria-label="工作空间设置分类">
          <Tabs.Tab id="channels">通知渠道<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="access">访问安全<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="history">记录维护<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="channels" shouldForceMount className={panel}>
        <ChannelManager active={activePanel === "channels"} onChanged={refresh} />
        {data ? <SettingsForm initial={data} onSaved={refresh} /> : !error && <Loading>正在读取通知偏好</Loading>}
      </Tabs.Panel>
      <Tabs.Panel id="access" shouldForceMount className={panel}><SecurityManager active={activePanel === "access"} /></Tabs.Panel>
      <Tabs.Panel id="history" shouldForceMount className={panel}><DataTransfer /><HistorySettings /><AuditLog active={activePanel === "history"} /></Tabs.Panel>
    </Tabs>
  </div>;
}

function SettingsForm({ initial, onSaved }: { initial: SettingsPayload; onSaved: () => Promise<void> }) {
  const { refresh } = useWorkspace();
  const [settings, setSettings] = useState<BarkSettings>({ ...initial.settings, deviceKey: "" });
  const [saved, setSaved] = useState<BarkSettings>({ ...initial.settings, deviceKey: "" });
  const [revision, setRevision] = useState(initial.revision);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const dirty = JSON.stringify(saved) !== JSON.stringify(settings);
  const conflict = initial.revision > revision;
  useUnsaved(dirty);
  useEffect(() => {
    if (dirty || initial.revision <= revision) return;
    const timer = setTimeout(() => {
      const next = { ...initial.settings, deviceKey: "" };
      setSettings(next); setSaved(next); setRevision(initial.revision);
    }, 0);
    return () => clearTimeout(timer);
  }, [initial, dirty, revision]);
  function reload() {
    const source = conflict ? initial : { settings: saved, revision };
    const next = { ...source.settings, deviceKey: "" };
    setSettings(next); setSaved(next); setRevision(source.revision); setFeedback(null);
  }
  function update(key: keyof BarkSettings, value: string) {
    setSettings((previous) => ({ ...previous, [key]: value }));
    setFeedback(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict || !dirty) return;
    setBusy(true); setFeedback(null);
    try {
      const response = await api<{ revision: number }>("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, revision }) });
      const next = { ...settings, deviceKey: "" };
      setSettings((current) => JSON.stringify(current) === JSON.stringify(settings) ? next : { ...current, deviceKey: current.deviceKey === settings.deviceKey ? "" : current.deviceKey });
      setSaved(next); setRevision(response.revision);
      setFeedback({ message: "通知偏好已保存。", kind: "success" }); void Promise.allSettled([refresh(), onSaved()]);
    } catch (error) { setFeedback({ message: errorMessage(error), kind: "error" }); void onSaved().catch(() => undefined); }
    finally { setBusy(false); }
  }
  return <Card className="gap-5 p-5 sm:p-6">
    <CardHeading title="通知偏好" />
    <Form className="grid min-w-0 gap-4" onSubmit={save}>
      {conflict && <Notice kind="warning" action={<Button type="button" variant="ghost" isDisabled={busy} onPress={reload}>载入最新设置</Button>}>设置已在其他页面更新。</Notice>}
      <TimeZonePicker label="显示时区" value={settings.displayTimeZone ?? "Asia/Shanghai"} onChange={(value) => update("displayTimeZone", value)} />
      <Details title="更多通知选项">
        <Field label="默认通知标题" value={settings.title} onChange={(event) => update("title", event.target.value)} maxLength={100} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="默认通知分组" value={settings.group} onChange={(event) => update("group", event.target.value)} maxLength={100} placeholder="Rubidium" />
          <Field label="默认提示音" value={settings.sound} onChange={(event) => update("sound", event.target.value)} maxLength={80} placeholder="1107" />
        </div>
        <Field label="默认通知图标 URL" value={settings.icon} onChange={(event) => update("icon", event.target.value)} placeholder="https://example.com/icon.png" type="url" maxLength={300} />
      </Details>
      {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" isDisabled={!dirty || busy} onPress={reload}>取消修改</Button>
        <Button type="submit" isPending={busy} isDisabled={!dirty || conflict}>保存偏好</Button>
      </div>
    </Form>
  </Card>;
}

function HistorySettings() {
  const { refresh, notify } = useWorkspace();
  const [pruning, setPruning] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);
  async function prune() {
    setPruning(true);
    try {
      const result = await api<{ removed: number }>("/api/deliveries", { method: "DELETE", body: JSON.stringify({ before: new Date(Date.now() - 30 * 86_400_000).toISOString(), all: true, compact: true }) });
      notify(`已清理 ${result.removed} 条结束记录，并回收数据库空间。`);
      setConfirmPrune(false);
      void refresh();
    } catch (error) { notify(errorMessage(error), "error"); }
    finally { setPruning(false); }
  }

  return <Card className="gap-4 p-5 sm:p-6">
    <CardHeading title="历史记录维护" />
    <Card.Footer><Button variant="danger-soft" onPress={() => setConfirmPrune(true)}>清理旧记录</Button></Card.Footer>
    {confirmPrune && <Confirm title="清理 30 天前的结束记录？" confirmLabel="清理记录" onClose={() => setConfirmPrune(false)} onConfirm={() => void prune()} busy={pruning}>
      <p>相应消息正文和尝试历史将永久删除。待投递和发送中的消息不会被清理。</p>
    </Confirm>}
  </Card>;
}
