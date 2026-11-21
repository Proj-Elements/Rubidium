"use client";

import { Button, Card, Chip, Form, Tabs } from "@heroui/react";
import { useEffect, useState, type FormEvent } from "react";
import { CardHeading, Confirm, Details, Field, Loading, Notice, PageHeading } from "@/components/primitives";
import { useUnsaved } from "@/components/use-unsaved";
import { useResource } from "@/components/use-resource";
import { useWorkspace } from "@/components/workspace-context";
import { DeviceManager } from "@/components/device-manager";
import { AuditLog, SecurityManager } from "@/components/security-manager";
import { TimeZonePicker } from "@/components/time-zone-picker";
import type { BarkSettings } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";

type SettingsPayload = { settings: Omit<BarkSettings, "deviceKey">; deviceKeyConfigured: boolean; dataDir: string; revision: number };

export default function SettingsPage() {
  const { data, error, refresh } = useResource<SettingsPayload>("/api/settings", 15_000);
  const panel = "grid min-w-0 gap-4 p-0 data-[inert]:hidden";

  return <div className="@container/settings grid gap-6">
    <PageHeading title="推送设置" />
    {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
    <Tabs className="settings-tabs min-w-0 gap-5" defaultSelectedKey="connection">
      <Tabs.ListContainer className="w-full min-w-0 self-start sm:w-fit">
        <Tabs.List className="grid w-full grid-cols-2 whitespace-nowrap sm:flex [&>[role=tab]]:min-h-11" aria-label="工作空间设置分类">
          <Tabs.Tab id="connection">连接配置<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="devices">更多设备<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="access">访问安全<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="history">记录维护<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="connection" shouldForceMount className={panel}>
        {data ? <SettingsForm initial={data} onSaved={refresh} /> : !error && <Loading>正在读取 Bark 配置</Loading>}
      </Tabs.Panel>
      <Tabs.Panel id="devices" shouldForceMount className={panel}><DeviceManager /></Tabs.Panel>
      <Tabs.Panel id="access" shouldForceMount className={panel}><SecurityManager /></Tabs.Panel>
      <Tabs.Panel id="history" shouldForceMount className={panel}><HistorySettings dataDir={data?.dataDir} /><AuditLog /></Tabs.Panel>
    </Tabs>
  </div>;
}

function SettingsForm({ initial, onSaved }: { initial: SettingsPayload; onSaved: () => Promise<void> }) {
  const { refresh, notify } = useWorkspace();
  const [settings, setSettings] = useState<BarkSettings>({ ...initial.settings, deviceKey: "" });
  const [saved, setSaved] = useState<BarkSettings>({ ...initial.settings, deviceKey: "" });
  const [configured, setConfigured] = useState(initial.deviceKeyConfigured);
  const [revision, setRevision] = useState(initial.revision);
  const [clearDeviceKey, setClearDeviceKey] = useState(false);
  const [confirmClearDeviceKey, setConfirmClearDeviceKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const dirty = clearDeviceKey || JSON.stringify(saved) !== JSON.stringify(settings);
  const conflict = initial.revision > revision;
  useUnsaved(dirty);
  useEffect(() => {
    if (dirty || initial.revision <= revision) return;
    const timer = setTimeout(() => {
      const next = { ...initial.settings, deviceKey: "" };
      setSettings(next); setSaved(next); setRevision(initial.revision); setConfigured(initial.deviceKeyConfigured); setClearDeviceKey(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [initial, dirty, revision]);
  function reload() {
    const source = conflict ? initial : { settings: saved, revision, deviceKeyConfigured: configured };
    const next = { ...source.settings, deviceKey: "" };
    setSettings(next); setSaved(next); setRevision(source.revision); setConfigured(source.deviceKeyConfigured); setClearDeviceKey(false); setFeedback(null);
  }
  function update(key: keyof BarkSettings, value: string) {
    setSettings((previous) => ({ ...previous, [key]: value }));
    if (key === "deviceKey") setClearDeviceKey(false);
    setFeedback(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict || !dirty) return;
    setBusy("save"); setFeedback(null);
    try {
      const response = await api<{ revision: number }>("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, revision, clearDeviceKey }) });
      const next = { ...settings, deviceKey: "" };
      setConfigured(clearDeviceKey ? false : configured || Boolean(settings.deviceKey.trim()));
      setSettings((current) => JSON.stringify(current) === JSON.stringify(settings) ? next : { ...current, deviceKey: current.deviceKey === settings.deviceKey ? "" : current.deviceKey });
      setSaved(next); setRevision(response.revision); setClearDeviceKey(false);
      setFeedback({ message: clearDeviceKey ? "设备连接已清除。已有队列会保留，配置新设备后继续尝试。" : "设置已保存。队列中的提醒将使用新配置继续尝试。", kind: "success" }); void Promise.allSettled([refresh(), onSaved()]);
    } catch (error) { setFeedback({ message: errorMessage(error), kind: "error" }); void onSaved().catch(() => undefined); }
    finally { setBusy(null); }
  }
  async function test() {
    setBusy("test"); setFeedback(null);
    try { await api("/api/settings/test", { method: "POST", body: "{}" }); notify("Bark 已确认接收测试通知，请查看你的设备。"); }
    catch (error) { setFeedback({ message: errorMessage(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  return <div className="grid items-start gap-5 @min-[52rem]/settings:grid-cols-[minmax(0,1.6fr)_minmax(15rem,1fr)]">
    <div className="grid min-w-0 gap-4">
      <Card className="gap-5 p-5 sm:p-6">
        <CardHeading title="连接 Bark" description="为提醒配置默认设备。" action={<Chip variant="soft" color={configured ? "success" : "default"}>
          <Chip.Label>{configured ? "设备已配置" : "等待连接"}</Chip.Label>
        </Chip>} />
        <Form className="grid min-w-0 gap-4" onSubmit={save}>
          {conflict && <Notice kind="warning" action={<Button type="button" variant="ghost" isDisabled={busy !== null} onPress={reload}>载入最新设置</Button>}>设置已在其他页面更新。</Notice>}
          {clearDeviceKey && <Notice kind="info" action={<Button type="button" variant="ghost" onPress={() => setClearDeviceKey(false)}>撤销</Button>}>保存后将清除当前 Device Key。</Notice>}
          <Field label="API 服务地址" value={settings.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://api.day.app" type="url" required maxLength={300} hint="无需添加 /push。更换地址时，填写新服务的 Device Key。" />
          {settings.endpoint.trim().toLowerCase().startsWith("http:") && <Notice kind="warning">当前使用明文 HTTP，跨网络连接建议使用 HTTPS。</Notice>}
          <Field label="Device Key" value={settings.deviceKey} onChange={(event) => update("deviceKey", event.target.value)}
            placeholder={configured ? "留空保留当前密钥" : "粘贴 Bark 设备密钥"} type="password" autoComplete="new-password" maxLength={300}
            hint={configured ? "密钥保存在服务端，不会在页面回显。" : "设备链接中，服务地址后的那段字符就是 Device Key。"} />
          <TimeZonePicker label="显示时区" value={settings.displayTimeZone ?? "Asia/Shanghai"} onChange={(value) => update("displayTimeZone", value)} />
          <Details title="更多通知选项">
            <Field label="测试通知标题" value={settings.title} onChange={(event) => update("title", event.target.value)} maxLength={100} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="通知分组" value={settings.group} onChange={(event) => update("group", event.target.value)} maxLength={100} placeholder="Rubidium" />
              <Field label="提示音" value={settings.sound} onChange={(event) => update("sound", event.target.value)} maxLength={80} placeholder="1107" />
            </div>
            <Field label="通知图标 URL" value={settings.icon} onChange={(event) => update("icon", event.target.value)} placeholder="https://example.com/icon.png" type="url" maxLength={300} hint="留空时使用 Bark 默认图标。" />
          </Details>
          {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted" aria-live="polite">{dirty ? "有尚未保存的修改" : "修改配置后，记得保存"}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" isDisabled={!dirty || busy !== null} onPress={reload}>取消修改</Button>
              <Button type="submit" isPending={busy === "save"} isDisabled={!dirty || busy === "test" || conflict}>保存设置</Button>
            </div>
          </div>
        </Form>
      </Card>
      {configured && !clearDeviceKey && <Button variant="danger-soft" className="justify-self-start" isDisabled={busy !== null} onPress={() => setConfirmClearDeviceKey(true)}>断开设备</Button>}
    </div>

    <div className="grid min-w-0 gap-5">
      <Card className="gap-4 p-5 sm:p-6">
        <CardHeading title="通知预览" />
        <Card.Content className="gap-3">
          <div className="grid gap-2 rounded-lg bg-surface-secondary p-4 text-sm">
            <p className="text-xs font-medium text-muted">Bark · 测试通知</p>
            <p className="line-clamp-2 font-semibold break-words">{settings.title || "Rubidium 提醒"}</p>
            <p className="line-clamp-2 leading-relaxed text-muted">这是一条来自 Rubidium 的测试通知。</p>
            {(settings.group || settings.sound) && <p className="line-clamp-1 text-xs break-words text-muted">分组：{settings.group || "无"} · 提示音：{settings.sound || "默认"}</p>}
          </div>
          <p id="test-notification-hint" className="text-xs leading-relaxed text-muted">{conflict ? "载入最新设置后再发送测试。" : dirty ? "保存当前配置后即可发送测试。" : !configured ? "先填写 Device Key 并保存，才能发送测试。" : "实际通知样式由 Bark 和设备决定。"}</p>
        </Card.Content>
        <Card.Footer>
          <Button variant="outline" aria-describedby="test-notification-hint" onPress={() => void test()} isPending={busy === "test"} isDisabled={!configured || dirty || busy === "save" || conflict}>发送测试</Button>
        </Card.Footer>
      </Card>
    </div>
    {confirmClearDeviceKey && <Confirm title="断开当前 Bark 设备？" confirmLabel="断开设备" onClose={() => setConfirmClearDeviceKey(false)} onConfirm={() => {
      setSettings((current) => ({ ...current, endpoint: saved.endpoint, deviceKey: "" }));
      setClearDeviceKey(true);
      setConfirmClearDeviceKey(false);
    }}><p>保存后将保留当前服务地址并清除 Device Key。队列中的消息会保留，重新配置设备后继续投递。</p></Confirm>}
  </div>;
}

function HistorySettings({ dataDir }: { dataDir?: string }) {
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
    <CardHeading title="历史记录维护" description="清理 30 天前已结束的投递记录并回收空间。累计排期与接收次数不变。" />
    <Card.Content className="gap-3">
      <Details title="存储与备份">
        <p className="text-sm leading-relaxed text-muted">任务、队列和配置保存在本机 SQLite 中。请使用服务端快照工具备份，或在停止服务后复制整个数据目录。</p>
        {dataDir && <code className="text-xs text-muted [overflow-wrap:anywhere]">{dataDir}/barker.sqlite</code>}
      </Details>
    </Card.Content>
    <Card.Footer><Button variant="danger-soft" onPress={() => setConfirmPrune(true)}>清理旧记录</Button></Card.Footer>
    {confirmPrune && <Confirm title="清理 30 天前的结束记录？" confirmLabel="清理记录" onClose={() => setConfirmPrune(false)} onConfirm={() => void prune()} busy={pruning}>
      <p>相应消息正文和尝试历史将永久删除。待投递和发送中的消息不会被清理。</p>
    </Confirm>}
  </Card>;
}
