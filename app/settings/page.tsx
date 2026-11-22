"use client";

import { Button, Card, Form, Tabs } from "@heroui/react";
import { useEffect, useState, type FormEvent } from "react";
import { CardHeading, Confirm, Details, Field, Loading, Notice, NumericField, PageHeading } from "@/components/primitives";
import { useUnsaved } from "@/components/use-unsaved";
import { useResource } from "@/components/use-resource";
import { useWorkspace } from "@/components/workspace-context";
import { ChannelManager } from "@/components/channel-manager";
import { AuditLog, SecurityManager } from "@/components/security-manager";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { DataTransfer } from "@/components/data-transfer";
import type { BarkSettings } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";
import { useTranslations } from "@/components/locale-provider";

type SettingsPayload = { settings: Omit<BarkSettings, "deviceKey">; deviceKeyConfigured: boolean; revision: number };

export default function SettingsPage() {
  const { t } = useTranslations();
  const [activePanel, setActivePanel] = useState("channels");
  const { data, error, refresh } = useResource<SettingsPayload>("/api/settings", 15_000, activePanel !== "access");
  const panel = "grid min-w-0 gap-4 p-0 data-[inert]:hidden";

  return <div className="@container/settings grid gap-6">
    <PageHeading title={t("settings.title")} />
    {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("common.retry")}</Button>}>{error}</Notice>}
    <Tabs className="settings-tabs min-w-0 gap-5" defaultSelectedKey="channels" onSelectionChange={(key) => setActivePanel(String(key))}>
      <Tabs.ListContainer className="w-full min-w-0 self-start sm:w-fit">
        <Tabs.List className="grid w-full grid-cols-3 whitespace-nowrap sm:flex [&>[role=tab]]:min-h-11" aria-label={t("settings.category")}>
          <Tabs.Tab id="channels">{t("settings.channels")}<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="access">{t("settings.security")}<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="history">{t("settings.history")}<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="channels" shouldForceMount className={panel}>
        <ChannelManager active={activePanel === "channels"} onChanged={refresh} />
        {data ? <SettingsForm initial={data} onSaved={refresh} /> : !error && <Loading>{t("settings.loadingPreferences")}</Loading>}
      </Tabs.Panel>
      <Tabs.Panel id="access" shouldForceMount className={panel}><SecurityManager active={activePanel === "access"} /></Tabs.Panel>
      <Tabs.Panel id="history" shouldForceMount className={panel}><DataTransfer /><HistorySettings initial={data} onSaved={refresh} /><AuditLog active={activePanel === "history"} /></Tabs.Panel>
    </Tabs>
  </div>;
}

function SettingsForm({ initial, onSaved }: { initial: SettingsPayload; onSaved: () => Promise<void> }) {
  const { t, locale } = useTranslations();
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
      setFeedback({ message: t("settings.preferencesSaved"), kind: "success" }); void Promise.allSettled([refresh(), onSaved()]);
    } catch (error) { setFeedback({ message: errorMessage(error, locale), kind: "error" }); void onSaved().catch(() => undefined); }
    finally { setBusy(false); }
  }
  return <Card className="gap-5 p-5 sm:p-6">
    <CardHeading title={t("settings.preferences")} />
    <Form className="grid min-w-0 gap-4" onSubmit={save}>
      {conflict && <Notice kind="warning" action={<Button type="button" variant="ghost" isDisabled={busy} onPress={reload}>{t("common.reloadLatest")}</Button>}>{t("settings.conflict")}</Notice>}
      <TimeZonePicker label={t("settings.timeZone")} value={settings.displayTimeZone ?? "Asia/Shanghai"} onChange={(value) => update("displayTimeZone", value)} />
      <Details title={t("settings.moreOptions")}>
        <Field label={t("settings.defaultTitle")} value={settings.title} onChange={(event) => update("title", event.target.value)} maxLength={100} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.defaultGroup")} value={settings.group} onChange={(event) => update("group", event.target.value)} maxLength={100} placeholder="Rubidium" />
          <Field label={t("settings.defaultSound")} value={settings.sound} onChange={(event) => update("sound", event.target.value)} maxLength={80} placeholder="1107" />
        </div>
        <Field label={t("settings.defaultIcon")} value={settings.icon} onChange={(event) => update("icon", event.target.value)} placeholder="https://example.com/icon.png" type="url" maxLength={300} />
      </Details>
      {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" isDisabled={!dirty || busy} onPress={reload}>{t("common.discard")}</Button>
        <Button type="submit" isPending={busy} isDisabled={!dirty || conflict}>{t("settings.savePreferences")}</Button>
      </div>
    </Form>
  </Card>;
}

function HistorySettings({ initial, onSaved }: { initial: SettingsPayload | null; onSaved: () => Promise<void> }) {
  const { t, locale } = useTranslations();
  const { refresh, notify } = useWorkspace();
  const [days, setDays] = useState(initial?.settings.historyRetentionDays ?? 0);
  const [savedDays, setSavedDays] = useState(initial?.settings.historyRetentionDays ?? 0);
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [editingDays, setEditingDays] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const dirty = days !== savedDays;
  const conflict = Boolean(initial && initial.revision > revision);

  useEffect(() => {
    if (!initial || dirty || initial.revision <= revision) return;
    const timer = setTimeout(() => {
      setDays(initial.settings.historyRetentionDays);
      setSavedDays(initial.settings.historyRetentionDays);
      setRevision(initial.revision);
    }, 0);
    return () => clearTimeout(timer);
  }, [initial, dirty, revision]);

  function reload() {
    if (!initial) return;
    setDays(initial.settings.historyRetentionDays);
    setSavedDays(initial.settings.historyRetentionDays);
    setRevision(initial.revision);
    setFeedback(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!initial || saving || conflict || !dirty) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await api<{ revision: number }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...initial.settings, historyRetentionDays: days, revision }),
      });
      setSavedDays(days);
      setRevision(result.revision);
      setFeedback({ message: t("settings.retentionSaved"), kind: "success" });
      void onSaved();
    } catch (error) {
      setFeedback({ message: errorMessage(error, locale), kind: "error" });
      void onSaved().catch(() => undefined);
    } finally { setSaving(false); }
  }

  async function prune() {
    setPruning(true);
    try {
      const result = await api<{ removed: number }>("/api/deliveries", { method: "DELETE", body: JSON.stringify({ before: new Date(Date.now() - 30 * 86_400_000).toISOString(), all: true }) });
      notify(t("settings.cleaned", { count: result.removed }));
      setConfirmPrune(false);
      void refresh();
    } catch (error) { notify(errorMessage(error, locale), "error"); }
    finally { setPruning(false); }
  }

  return <Card className="history-settings-card">
    <CardHeading title={t("settings.history")} />
    {initial ? <Form className="history-settings-form" onSubmit={save}>
      {conflict && <div className="basis-full"><Notice kind="warning" action={<Button type="button" variant="ghost" isDisabled={saving} onPress={reload}>{t("common.reloadLatest")}</Button>}>{t("settings.retentionConflict")}</Notice></div>}
      <NumericField label={t("settings.retentionDays")} value={days} onChange={setDays} onFocus={() => setEditingDays(true)} onBlur={() => setEditingDays(false)} minValue={0} maxValue={36500} isRequired isDisabled={saving} />
      {feedback && <div className="basis-full"><Notice kind={feedback.kind}>{feedback.message}</Notice></div>}
      <div className="history-settings-actions">
        <Button type="button" variant="ghost" isDisabled={!dirty || saving} onPress={reload}>{t("common.discard")}</Button>
        <Button type="submit" isPending={saving} isDisabled={(!dirty && !editingDays) || conflict}>{t("settings.saveRetention")}</Button>
      </div>
    </Form> : <Loading>{t("settings.loadingRetention")}</Loading>}
    <Button className="history-prune-action" variant="danger-soft" onPress={() => setConfirmPrune(true)}>{t("settings.cleanOld")}</Button>
    {confirmPrune && <Confirm title={t("settings.cleanTitle")} confirmLabel={t("settings.cleanConfirm")} onClose={() => setConfirmPrune(false)} onConfirm={() => void prune()} busy={pruning}>
      <p>{t("settings.cleanDescription")}</p>
    </Confirm>}
  </Card>;
}
