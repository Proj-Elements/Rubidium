"use client";

import { Button, Fieldset, Form, Modal, Popover, Separator, Tabs } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DEFAULT_REMINDER_BODY, REMINDER_CONTENT_MAX_BYTES, reminderContentBytes } from "@/lib/contracts";
import type { Device, RecurrencePreset, Task, TaskInput } from "@/lib/types";
import { api, clientPresetCron, createIdempotencyKey, duplicateStart, errorMessage, localDateValue, localInputValue, PRESET_LABELS, SCHEDULE_TIME_ZONE, toOffsetDateTime } from "@/lib/ui";
import { useTime } from "./use-time";
import { CalendarField } from "./calendar-field";
import { Glyph } from "./icons";
import { AreaField, Confirm, Details, Field, IconButton, Notice, NumericField, Pick } from "./primitives";
import { useWorkspace } from "./workspace-context";
import { useUnsaved } from "./use-unsaved";
import { useResource } from "./use-resource";

export function TaskEditor({ task, duplicate = false, onClose }: { task?: Task; duplicate?: boolean; onClose: () => void }) {
  const { formatTime, timeZone: displayTimeZone } = useTime();
  const [persisted, setPersisted] = useState<Task | undefined>(duplicate ? undefined : task);
  const editing = Boolean(persisted);
  const { refresh, notify, dashboard } = useWorkspace();
  const { data: devices } = useResource<{ devices: Device[] }>("/api/devices", 0);
  const [name, setName] = useState(task ? duplicate ? `${task.name.slice(0, 76)}（副本）` : task.name : "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [timeZone, setTimeZone] = useState(task?.timeZone ?? SCHEDULE_TIME_ZONE);
  const [startsAt, setStartsAt] = useState(() => task ? duplicate ? duplicateStart(task) : localInputValue(new Date(task.startsAt), task.timeZone) : localInputValue(new Date(Date.now() + 300_000)));
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
  const payload = useMemo<TaskInput>(() => ({
    name, description, startsAt: toOffsetDateTime(startsAt, timeZone), timeZone,
    maxLatenessMinutes: Number.isNaN(lateness) ? null : lateness, preset, cron: generatedCron,
    repeatCount: preset === "once" ? 1 : limit === "count" ? count : null,
    endDate: preset !== "once" && limit === "date" ? endDate : null,
    deviceId, notification: { ...(sound ? { sound } : {}), ...(group ? { group } : {}) },
    skipDates: skipDates.split(/[\s,，]+/).filter(Boolean),
    includeDates: preset === "weekdays" ? includeDates.split(/[\s,，]+/).filter(Boolean) : [],
  }), [name, description, startsAt, timeZone, lateness, preset, generatedCron, limit, count, endDate, deviceId, sound, group, skipDates, includeDates]);
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
    name: "预览", startsAt: payload.startsAt, timeZone, preset, cron: generatedCron, repeatCount: payload.repeatCount,
    endDate: payload.endDate, skipDates: payload.skipDates, includeDates: payload.includeDates, taskId: persisted?.id,
  }) : "";
  const [preview, setPreview] = useState<{ key: string; dates: string[]; error: string }>({ key: "", dates: [], error: "" });
  useEffect(() => {
    if (!previewKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ dates: string[] }>("/api/tasks/preview", { method: "POST", body: previewKey, signal: controller.signal })
        .then((data) => setPreview({ key: previewKey, dates: data.dates, error: "" }))
        .catch((error) => { if (!controller.signal.aborted) setPreview({ key: previewKey, dates: [], error: errorMessage(error) }); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [previewKey, previewVersion]);

  const currentPreview = previewKey && preview.key === previewKey ? preview : null;
  const nextPreview = currentPreview?.dates[0];
  const previewStatus = !previewKey ? "请选择有效的开始时间。" : !currentPreview ? "正在计算排期…"
    : currentPreview.error ? "暂时无法预览 · 查看原因" : "没有剩余排期";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (contentOverLimit) {
      descriptionInput.current?.focus();
      return;
    }
    if (preset !== "once" && limit === "count" && !Number.isInteger(count)) {
      setError("请输入有效的重复次数。");
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
      notify(editing ? "提醒已更新，已排队的消息保持原样。" : "提醒已创建。");
      void refresh();
      window.dispatchEvent(new Event("barker:tasks-changed"));
      if (latestPayload.current === serialized) onClose();
      else setError("提交内容已保存；保存期间的新修改仍保留在这里，请再次保存。");
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <>
    <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) close(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
      <Modal.Container size="lg" placement="auto" scroll="inside"><Modal.Dialog className="p-0">
        <Form className="flex min-h-0 flex-col" onSubmit={save}>
          <Modal.Header className="shrink-0 flex-row items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div className="space-y-1">
              <Modal.Heading className="text-xl font-semibold">{editing ? "编辑提醒" : duplicate ? "复制为新提醒" : "新建提醒"}</Modal.Heading>
              <p className="text-sm text-muted">设置通知内容和发送时间。</p>
            </div>
            <IconButton label="关闭编辑器" icon="close" isDisabled={busy} onPress={close} />
          </Modal.Header>

          <Modal.Body className="grid content-start gap-3 px-5 py-3 sm:gap-4 sm:px-6 sm:py-4">
            <Field label="提醒名称" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="例如：给绿植浇水" />
            <AreaField label="提醒内容" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000}
              ref={descriptionInput} placeholder={`可选，默认「${DEFAULT_REMINDER_BODY}」`} className="resize-y"
              hint={`标题与正文用量 ${contentSize} / ${REMINDER_CONTENT_MAX_BYTES} 字节`}
              error={contentOverLimit ? `内容超出 ${contentSize - REMINDER_CONTENT_MAX_BYTES} 字节，请缩短标题或正文。` : undefined} />

            <Fieldset className="min-w-0">
              <Fieldset.Legend className="mb-2 pt-1 font-semibold">排期 <span className="ms-2 text-xs font-normal text-muted [overflow-wrap:anywhere]">{timeZone}</span></Fieldset.Legend>
              <Fieldset.Group className="grid gap-3 space-y-0 sm:gap-4">
                <div className="grid items-start gap-3 sm:grid-cols-[1.3fr_1fr] sm:gap-4">
                  <CalendarField label="开始时间" value={startsAt} onChange={setStartsAt} timeZone={timeZone} />
                  <Pick label="重复周期" value={preset} onChange={(value) => setPreset(value as RecurrencePreset)} options={Object.entries(PRESET_LABELS).map(([value, label]) => ({ value, label }))} />
                </div>
                {preset === "custom" && <Field label="Cron 表达式" value={cron} onChange={(event) => setCron(event.target.value)} required maxLength={80} hint="标准五段格式：分 时 日 月 周。" />}
                {preset === "monthly" && Number(startsAt.slice(8, 10)) > 28 && <Notice kind="info">短月不存在的日期会跳过。</Notice>}
                {preset !== "once" && <section className="grid gap-2" aria-label="结束条件">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><h3 className="font-medium text-foreground">何时结束</h3>{persisted && <span className="text-muted tabular-nums">已排期 {persisted.queuedCount} 次</span>}</div>
                  <Tabs className="min-w-0" selectedKey={limit} onSelectionChange={(key) => setLimit(String(key))}>
                    <Tabs.ListContainer className="w-fit max-w-full self-start"><Tabs.List aria-label="提醒结束方式" className="whitespace-nowrap">
                      <Tabs.Tab id="count">按次数<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="date">按日期<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="never">持续重复<Tabs.Indicator /></Tabs.Tab>
                    </Tabs.List></Tabs.ListContainer>
                    <Tabs.Panel id="count" className="mt-2 p-0"><NumericField label="重复次数" minValue={1} maxValue={100000} value={count} onChange={setCount} isRequired /></Tabs.Panel>
                    <Tabs.Panel id="date" className="mt-2 p-0"><CalendarField label="截止日期（含当天）" value={endDate} onChange={setEndDate} timeZone={timeZone} dateOnly /></Tabs.Panel>
                    <Tabs.Panel id="never" className="mt-2 p-0 text-sm text-muted">持续排期，直到暂停或归档。</Tabs.Panel>
                  </Tabs>
                </section>}
              </Fieldset.Group>
            </Fieldset>

            <Pick label="投递设备" value={deviceId} onChange={setDeviceId} options={(devices?.devices ?? [{ id: "default", name: "默认设备" }]).map((device) => ({ value: device.id, label: device.name }))} />
            {dashboard && !dashboard.deviceKeyConfigured && deviceId === "default" && <Notice kind="info" action={<Link href="/settings" className="link workspace-link">前往设置</Link>}>默认设备未连接。</Notice>}

            <Details title="时区、节假日与通知策略">
              <Field label="排期时区" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required hint="IANA 时区，例如 Asia/Shanghai 或 UTC。" />
              <Field label="跳过日期" value={skipDates} onChange={(event) => setSkipDates(event.target.value)} hint="填写 YYYY-MM-DD，多个日期用逗号分隔。" />
              {preset === "weekdays" && <Field label="补班日期" value={includeDates} onChange={(event) => setIncludeDates(event.target.value)} hint="补充周末工作日，沿用开始时间的时分。" />}
              <NumericField label="允许延迟（分钟）" minValue={1} maxValue={525600} value={lateness} onChange={setLateness} hint="可留空；永久错误仍须手动处理。" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="任务通知分组" value={group} onChange={(event) => setGroup(event.target.value)} maxLength={100} placeholder="使用全局设置" />
                <Field label="任务提示音" value={sound} onChange={(event) => setSound(event.target.value)} maxLength={80} placeholder="使用全局设置" />
              </div>
              <section className="space-y-2 rounded-lg bg-surface-secondary p-4 text-sm">
                <h3 className="text-xs font-medium text-muted">通知预览</h3>
                <p className="line-clamp-1 font-semibold break-words">{name || "提醒名称"}</p>
                <p className="line-clamp-3 break-words whitespace-pre-line text-muted">{description.trim() || DEFAULT_REMINDER_BODY}</p>
                <p className="line-clamp-1 text-xs break-words text-muted">分组：{group || "全局设置"} · 提示音：{sound || "全局设置"}</p>
              </section>
            </Details>
          </Modal.Body>

          <Separator />
          <Modal.Footer className="shrink-0 flex-col items-stretch gap-2 px-5 pt-3 pb-4 sm:gap-3 sm:px-6 sm:pb-5">
            <Popover>
              <Button type="button" variant="tertiary" fullWidth className="h-auto min-h-12 justify-between gap-2 rounded-lg px-3 py-2 text-start">
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-xs font-medium text-muted">排期预览</span>
                  <span className={currentPreview?.error ? "text-danger-soft-foreground" : "tabular-nums"} aria-live="polite">
                    {nextPreview ? <>{persisted?.status === "paused" && "若恢复 · "}<time dateTime={nextPreview}>{formatTime(nextPreview)}</time></> : previewStatus}
                  </span>
                </span>
                <Glyph name="chevronDown" size={14} className="shrink-0 rotate-180 text-muted" />
              </Button>
              <Popover.Content placement="top start" className="w-72 max-w-[calc(100vw-2rem)] rounded-lg">
                <Popover.Dialog className="grid gap-2 p-3">
                  <Popover.Heading className="font-semibold">接下来的提醒</Popover.Heading>
                  <p className="text-xs text-muted">显示时区：{displayTimeZone}</p>
                  {nextPreview ? <ol className="list-decimal space-y-1 ps-5 tabular-nums">{currentPreview?.dates.slice(0, 3).map((date) => <li key={date}><time dateTime={date}>{formatTime(date)}</time></li>)}</ol>
                    : <p className={currentPreview?.error ? "text-danger-soft-foreground" : "text-muted"}>{currentPreview?.error || previewStatus}</p>}
                  {generatedCron && <p className="text-xs text-muted">Cron <code className="[overflow-wrap:anywhere]">{generatedCron}</code></p>}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            {error && <div className="max-h-28 overflow-y-auto"><Notice>{error}</Notice></div>}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" className="max-sm:min-h-11" isDisabled={busy} onPress={close}>取消</Button>
              <Button type="submit" className="max-sm:min-h-11" isPending={busy}>{editing ? "保存修改" : "创建提醒"}</Button>
            </div>
          </Modal.Footer>
        </Form>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
    {discardChanges && <Confirm title="放弃尚未保存的修改？" confirmLabel="放弃修改" cancelLabel="继续编辑" onClose={() => setDiscardChanges(false)} onConfirm={onClose}>
      <p>关闭后，这次对提醒表单的修改将不会保留。</p>
    </Confirm>}
  </>;
}
