"use client";

import { Segment } from "@heroui-pro/react";

import { Button, Fieldset, Form, Modal, Popover, Separator, Tooltip } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { REMINDER_CONTENT_MAX_BYTES, reminderContentBytes } from "@/lib/contracts";
import type { Channel, RecurrencePreset, Task, TaskInput } from "@/lib/types";
import { api, clientPresetCron, createIdempotencyKey, duplicateStart, errorMessage, localDateValue, localInputValue, toOffsetDateTime } from "@/lib/ui";
import { presetMessageKeys } from "@/lib/i18n";
import { useTime } from "./use-time";
import { CalendarField } from "./calendar-field";
import { Glyph } from "./icons";
import { AreaField, Confirm, Details, Field, Notice, NumericField, Pick, WorkspaceLink } from "./primitives";
import { useWorkspace } from "./workspace-context";
import { useUnsaved } from "./use-unsaved";
import { useResource } from "./use-resource";
import { TimeZonePicker } from "./time-zone-picker";
import { useTranslations } from "./locale-provider";

export function TaskEditor({ task, duplicate = false, onClose }: { task?: Task; duplicate?: boolean; onClose: () => void }) {
  const { t, locale } = useTranslations();
  const { formatTime, timeZone: displayTimeZone } = useTime();
  const [persisted, setPersisted] = useState<Task | undefined>(duplicate ? undefined : task);
  const editing = Boolean(persisted);
  const { refresh, notify, dashboard } = useWorkspace();
  const { data: channels } = useResource<{ channels: Channel[] }>("/api/channels", 0);
  const [name, setName] = useState(task ? duplicate ? `${task.name.slice(0, 80 - t("reminder.duplicateSuffix").length)}${t("reminder.duplicateSuffix")}` : task.name : "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [timeZone, setTimeZone] = useState(task?.timeZone ?? displayTimeZone);
  const [startsAt, setStartsAt] = useState(() => task ? duplicate ? duplicateStart(task) : localInputValue(new Date(task.startsAt), task.timeZone) : localInputValue(new Date(Date.now() + 300_000), displayTimeZone));
  const [preset, setPreset] = useState<RecurrencePreset>(task?.preset ?? "once");
  const [cron, setCron] = useState(task?.cron ?? "0 9 * * *");
  const [limit, setLimit] = useState(task?.endDate ? "date" : task && task.repeatCount === null ? "never" : "count");
  const [count, setCount] = useState(task?.repeatCount ?? 30);
  const [endDate, setEndDate] = useState(() => {
    const today = localDateValue(new Date(), timeZone);
    if (task?.endDate && (!duplicate || task.endDate >= today)) return task.endDate;
    return parseDate(today).add({ days: 30 }).toString();
  });
  const [busy, setBusy] = useState(false);
  const [discardChanges, setDiscardChanges] = useState(false);
  const [error, setError] = useState("");
  const [lateness, setLateness] = useState(task?.maxLatenessMinutes ?? NaN);
  const [deviceId, setDeviceId] = useState(task?.deviceId ?? "default");
  const [sound, setSound] = useState(task?.notification?.sound ?? "");
  const [group, setGroup] = useState(task?.notification?.group ?? "");
  const [skipDates, setSkipDates] = useState(task?.skipDates?.join(", ") ?? "");
  const [includeDates, setIncludeDates] = useState(task?.includeDates?.join(", ") ?? "");
  const [previewVersion, setPreviewVersion] = useState(0);
  const creation = useRef<{ payload: string; key: string } | null>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const contentSize = reminderContentBytes(name, description);
  const contentOverLimit = contentSize > REMINDER_CONTENT_MAX_BYTES;
  const generatedCron = preset === "custom" ? cron : clientPresetCron(preset, startsAt);
  const savedStart = persisted?.startsAt ?? (duplicate ? task?.nextRunAt ?? task?.startsAt : task?.startsAt);
  const payload = useMemo<TaskInput>(() => ({
    name, description, startsAt: toOffsetDateTime(startsAt, timeZone, savedStart), timeZone,
    maxLatenessMinutes: Number.isNaN(lateness) ? null : lateness, preset, cron: generatedCron,
    repeatCount: preset === "once" ? 1 : limit === "count" ? count : null,
    endDate: preset !== "once" && limit === "date" ? endDate : null,
    deviceId, notification: { ...task?.notification, sound: sound || undefined, group: group || undefined },
    skipDates: skipDates.split(/[\s,，]+/).filter(Boolean),
    includeDates: preset === "weekdays" ? includeDates.split(/[\s,，]+/).filter(Boolean) : [],
  }), [name, description, startsAt, timeZone, savedStart, lateness, preset, generatedCron, limit, count, endDate, deviceId, task?.notification, sound, group, skipDates, includeDates]);
  const serialized = JSON.stringify(payload);
  const [savedPayload, setSavedPayload] = useState(serialized);
  const latestPayload = useRef(serialized);
  useEffect(() => { latestPayload.current = serialized; }, [serialized]);
  const dirty = serialized !== savedPayload;
  useUnsaved(dirty);
  function close() {
    if (busy) return;
    if (dirty) setDiscardChanges(true);
    else onClose();
  }
  useEffect(() => { const timer = setInterval(() => setPreviewVersion((value) => value + 1), 30_000); return () => clearInterval(timer); }, []);
  const previewKey = payload.startsAt ? JSON.stringify({
    name: t("reminder.preview"), startsAt: payload.startsAt, timeZone, preset, cron: generatedCron, repeatCount: payload.repeatCount,
    endDate: payload.endDate, skipDates: payload.skipDates, includeDates: payload.includeDates, taskId: persisted?.id,
  }) : "";
  const [preview, setPreview] = useState<{ key: string; dates: string[]; error: string }>({ key: "", dates: [], error: "" });
  useEffect(() => {
    if (!previewKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ dates: string[] }>("/api/tasks/preview", { method: "POST", body: previewKey, signal: controller.signal })
        .then((data) => setPreview({ key: previewKey, dates: data.dates, error: "" }))
        .catch((error) => { if (!controller.signal.aborted) setPreview({ key: previewKey, dates: [], error: errorMessage(error, locale) }); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [previewKey, previewVersion, locale]);

  const currentPreview = previewKey && preview.key === previewKey ? preview : null;
  const nextPreview = currentPreview?.dates[0];
  const previewStatus = !previewKey ? t("reminder.noValidStart") : !currentPreview ? t("reminder.calculating")
    : currentPreview.error ? t("reminder.previewUnavailable") : t("reminder.noOccurrences");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (contentOverLimit) {
      descriptionInput.current?.focus();
      return;
    }
    if (preset !== "once" && limit === "count" && !Number.isInteger(count)) {
      setError(t("reminder.validCountRequired"));
      return;
    }
    setBusy(true);
    try {
      const body = JSON.stringify({ ...payload, ...(persisted ? { revision: persisted.revision } : {}) });
      if (!creation.current || creation.current.payload !== body) creation.current = { payload: body, key: createIdempotencyKey() };
      const response = await api<{ task: Task }>(persisted ? `/api/tasks/${persisted.id}` : "/api/tasks", {
        method: persisted ? "PUT" : "POST", headers: persisted ? {} : { "idempotency-key": creation.current.key }, body,
      });
      setPersisted(response.task); setSavedPayload(serialized);
      notify(editing ? t("reminder.updated") : t("reminder.saved"));
      void refresh();
      window.dispatchEvent(new Event("rubidium:tasks-changed"));
      if (latestPayload.current === serialized) onClose();
      else setError(t("reminder.savedWithNewEdits"));
    } catch (error) { setError(errorMessage(error, locale)); }
    finally { setBusy(false); }
  }

  return <>
    <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) close(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
      <Modal.Container size="lg" placement="auto" scroll="inside"><Modal.Dialog className="p-0">
        <Form className="flex min-h-0 flex-col" onSubmit={save}>
          <Modal.Header className="shrink-0 flex-row items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div className="space-y-1">
              <Modal.Heading className="text-xl font-semibold">{editing ? t("reminder.edit") : duplicate ? t("reminder.duplicate") : t("reminder.create")}</Modal.Heading>
            </div>
            <Tooltip delay={350}>
              <Modal.CloseTrigger aria-label={t("reminder.closeEditor")} className="static shrink-0 max-sm:size-11" isDisabled={busy} />
              <Tooltip.Content>{t("reminder.closeEditor")}</Tooltip.Content>
            </Tooltip>
          </Modal.Header>

          <Modal.Body className="@container/editor grid content-start gap-5 px-5 py-4 sm:px-6 sm:py-5">
            <div className="grid gap-3">
              <Field label={t("reminder.name")} value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder={t("reminder.namePlaceholder")} />
              <AreaField label={t("reminder.content")} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000}
                ref={descriptionInput} placeholder={t("reminder.contentPlaceholderWithDefault", { body: t("reminder.defaultBody") })} className="resize-y"
                error={contentOverLimit ? t("reminder.contentTooLong", { count: contentSize - REMINDER_CONTENT_MAX_BYTES }) : undefined} />
            </div>

            <Fieldset className="min-w-0">
              <Fieldset.Legend className="mb-1 pt-1 font-semibold">{t("reminder.schedule")} <span className="ms-2 text-xs font-normal text-muted [overflow-wrap:anywhere]">{timeZone}</span></Fieldset.Legend>
              <Fieldset.Group className="grid gap-3 space-y-0 sm:gap-4">
                <div className="grid items-start gap-3 sm:grid-cols-[1.3fr_1fr] sm:gap-4">
                  <CalendarField label={t("reminder.startTime")} value={startsAt} onChange={setStartsAt} timeZone={timeZone} />
                  <Pick label={t("reminder.repeat")} value={preset} onChange={(value) => setPreset(value as RecurrencePreset)} options={Object.entries(presetMessageKeys).map(([value, key]) => ({ value, label: t(key) }))} />
                </div>
                {preset === "custom" && <Field label={t("reminder.cron")} value={cron} onChange={(event) => setCron(event.target.value)} required maxLength={80} />}
                {preset !== "once" && <section className="grid gap-2" aria-label={t("reminder.endConditions")}>
                  <div className="grid items-start gap-3 @min-[26rem]/editor:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    <div className="workspace-field grid gap-1">
                      <h3 className="label font-medium text-foreground">{t("reminder.ends")}</h3>
                      <Segment aria-label={t("reminder.endCondition")} className="w-fit max-w-full" selectedKey={limit} onSelectionChange={(key) => setLimit(String(key))}>
                        <Segment.Item id="count">{t("reminder.afterCount")}</Segment.Item>
                        <Segment.Item id="date">{t("reminder.onDate")}</Segment.Item>
                        <Segment.Item id="never">{t("reminder.never")}</Segment.Item>
                      </Segment>
                    </div>
                    {limit === "count" && <NumericField label={t("reminder.repeatCount")} minValue={1} maxValue={100000} value={count} onChange={setCount} isRequired />}
                    {limit === "date" && <CalendarField label={t("reminder.endDate")} value={endDate} onChange={setEndDate} timeZone={timeZone} dateOnly />}
                  </div>
                  {persisted && <p className="text-xs leading-relaxed text-muted tabular-nums">{t("reminder.scheduledCount", { count: persisted.queuedCount })}</p>}
                </section>}
              </Fieldset.Group>
            </Fieldset>

            <div className="grid gap-3">
              <Pick label={t("reminder.channel")} value={deviceId} onChange={setDeviceId} options={(channels?.channels ?? [{ id: "default", name: t("channel.defaultName"), type: "bark" as const, isDefault: true }]).map((channel) => ({
                value: channel.id, label: `${channel.name} · ${channel.type === "ntfy" ? "Ntfy" : "Bark"}`,
              }))} />
              {dashboard?.defaultChannel.type === "bark" && !dashboard.defaultChannel.credentialConfigured && deviceId === "default" && <Notice kind="info" action={<WorkspaceLink href="/settings" className="workspace-link">{t("reminder.openSettings")}</WorkspaceLink>}>{t("reminder.barkMissing")}</Notice>}
            </div>

            <Details title={t("reminder.advanced")}>
              <TimeZonePicker label={t("reminder.timeZone")} value={timeZone} onChange={setTimeZone} />
              <Field label={t("reminder.skipDates")} value={skipDates} onChange={(event) => setSkipDates(event.target.value)} placeholder="2026-12-25, 2027-01-01" />
              {preset === "weekdays" && <Field label={t("reminder.extraWorkdays")} value={includeDates} onChange={(event) => setIncludeDates(event.target.value)} placeholder="2026-12-26" />}
              <NumericField label={t("reminder.maxDelay")} minValue={1} maxValue={525600} value={lateness} onChange={setLateness} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("reminder.notificationGroup")} value={group} onChange={(event) => setGroup(event.target.value)} maxLength={100} placeholder={t("reminder.useGlobal")} />
                <Field label={t("reminder.sound")} value={sound} onChange={(event) => setSound(event.target.value)} maxLength={80} placeholder={t("reminder.useGlobal")} />
              </div>
              <section className="notification-preview grid gap-2 rounded-lg bg-surface-secondary p-4 text-sm">
                <h3 className="text-xs font-medium text-muted">{t("reminder.preview")}</h3>
                <p className="line-clamp-1 font-semibold break-words">{name || t("reminder.notificationTitle")}</p>
                <p className="line-clamp-3 break-words whitespace-pre-line text-muted">{description.trim() || t("reminder.defaultBody")}</p>
                <p className="line-clamp-1 text-xs break-words text-muted">{t("reminder.groupLabel", { group: group || t("reminder.globalSettings"), sound: sound || t("reminder.globalSettings") })}</p>
              </section>
            </Details>
          </Modal.Body>

          <Separator />
          <Modal.Footer className="shrink-0 flex-col items-stretch gap-2 px-5 pt-3 pb-4 sm:gap-3 sm:px-6 sm:pb-5">
            <Popover>
              <Button type="button" variant="tertiary" fullWidth className="h-auto min-h-12 justify-between gap-2 rounded-lg px-3 py-2 text-start">
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-xs font-medium text-muted">{t("reminder.schedulePreview")}</span>
                  <span className={currentPreview?.error ? "text-danger-soft-foreground" : "tabular-nums"} aria-live="polite">
                    {nextPreview ? <>{persisted?.status === "paused" && t("reminder.previewPaused")}<time dateTime={nextPreview}>{formatTime(nextPreview)}</time></> : previewStatus}
                  </span>
                </span>
                <Glyph name="chevronDown" size={14} className="shrink-0 rotate-180 text-muted" />
              </Button>
              <Popover.Content placement="top start" className="w-72 max-w-[calc(100vw-2rem)] rounded-lg">
                <Popover.Dialog className="grid gap-2 p-3">
                  <Popover.Heading className="font-semibold">{t("reminder.upcoming")}</Popover.Heading>
                  <p className="text-xs text-muted">{t("reminder.displayTimeZone", { zone: displayTimeZone })}</p>
                  {nextPreview ? <ol className="list-decimal space-y-1 ps-5 tabular-nums">{currentPreview?.dates.slice(0, 3).map((date) => <li key={date}><time dateTime={date}>{formatTime(date)}</time></li>)}</ol>
                    : <p className={currentPreview?.error ? "text-danger-soft-foreground" : "text-muted"}>{currentPreview?.error || previewStatus}</p>}
                  {generatedCron && <p className="text-xs text-muted">Cron <code className="[overflow-wrap:anywhere]">{generatedCron}</code></p>}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            {error && <div className="max-h-28 overflow-y-auto"><Notice>{error}</Notice></div>}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" className="max-sm:min-h-11" isDisabled={busy} onPress={close}>{t("common.cancel")}</Button>
              <Button type="submit" className="max-sm:min-h-11" isPending={busy}>{editing ? t("reminder.saveChanges") : t("reminder.create")}</Button>
            </div>
          </Modal.Footer>
        </Form>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
    {discardChanges && <Confirm title={t("reminder.discardTitle")} confirmLabel={t("common.abandonChanges")} cancelLabel={t("common.continueEditing")} onClose={() => setDiscardChanges(false)} onConfirm={onClose}>
      <p>{t("reminder.discardDescription")}</p>
    </Confirm>}
  </>;
}
