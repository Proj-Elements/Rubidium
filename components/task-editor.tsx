"use client";

import { Button, Form, Modal, Tabs } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Device, RecurrencePreset, Task, TaskInput } from "@/lib/types";
import { api, clientPresetCron, createIdempotencyKey, duplicateStart, errorMessage, localDateValue, localInputValue, PRESET_LABELS, SCHEDULE_TIME_ZONE, toOffsetDateTime } from "@/lib/ui";
import { useTime } from "./use-time";
import { CalendarField } from "./calendar-field";
import { AreaField, Confirm, Details, Field, IconButton, Notice, NumericField, Pick } from "./primitives";
import { useWorkspace } from "./workspace-context";
import { useUnsaved } from "./use-unsaved";
import { useResource } from "./use-resource";

export function TaskEditor({ task, duplicate = false, onClose }: { task?: Task; duplicate?: boolean; onClose: () => void }) {
  const { formatTime } = useTime();
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
  const previewKey = JSON.stringify({ ...payload, name: "预览", description: "", ...(persisted ? { taskId: persisted.id } : {}) });
  const [preview, setPreview] = useState<{ key: string; dates: string[]; error: string }>({ key: "", dates: [], error: "" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ dates: string[] }>("/api/tasks/preview", { method: "POST", body: previewKey, signal: controller.signal })
        .then((data) => setPreview({ key: previewKey, dates: data.dates, error: "" }))
        .catch((error) => { if (!controller.signal.aborted) setPreview({ key: previewKey, dates: [], error: errorMessage(error) }); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [previewKey, previewVersion]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preset !== "once" && limit === "count" && !Number.isInteger(count)) {
      setError("请输入有效的重复次数。");
      return;
    }
    setBusy(true); setError("");
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
      <Modal.Container size="lg" placement="center" scroll="inside"><Modal.Dialog className="p-0">
        <Form className="flex min-h-0 flex-col" onSubmit={save}>
          <Modal.Header className="flex-row items-start justify-between gap-3 px-5 pt-5 sm:px-6">
            <div className="space-y-1">
              <Modal.Heading className="text-xl font-semibold">{editing ? "编辑提醒" : duplicate ? "复制为新提醒" : "留一个提醒给未来"}</Modal.Heading>
              <p className="text-sm text-muted">填写通知内容并安排发送时间。</p>
            </div>
            <IconButton label="关闭编辑器" icon="close" isDisabled={busy} onPress={close} />
          </Modal.Header>

          <Modal.Body className="gap-5 px-5 py-4 sm:px-6">
            {error && <Notice>{error}</Notice>}
            <Field label="提醒名称" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoFocus />
            <AreaField label="提醒内容" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} hint="标题与正文合计最多 3000 个 UTF-8 字节。" />

            <div className="grid items-start gap-4 sm:grid-cols-[1.3fr_1fr]">
              <CalendarField label="开始时间" value={startsAt} onChange={setStartsAt} timeZone={timeZone} />
              <Pick label="重复周期" value={preset} onChange={(value) => setPreset(value as RecurrencePreset)} options={Object.entries(PRESET_LABELS).map(([value, label]) => ({ value, label }))} />
            </div>
            {preset === "custom" && <Field label="Cron 表达式" value={cron} onChange={(event) => setCron(event.target.value)} required maxLength={80} hint="标准五段格式：分 时 日 月 周。" />}
            {preset === "monthly" && Number(startsAt.slice(8, 10)) > 28 && <Notice kind="info">短月不存在的日期会跳过。</Notice>}
            {preset !== "once" && <section className="grid gap-2" aria-label="结束条件">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><h3 className="font-medium">何时结束</h3>{persisted && <span className="text-muted tabular-nums">已排期 {persisted.queuedCount} 次</span>}</div>
              <Tabs selectedKey={limit} onSelectionChange={(key) => setLimit(String(key))}>
                <Tabs.ListContainer><Tabs.List aria-label="提醒结束方式" className="w-fit">
                  <Tabs.Tab id="count">按次数<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="date">按日期<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="never">持续重复<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List></Tabs.ListContainer>
                <Tabs.Panel id="count" className="pt-3"><NumericField label="重复次数" minValue={1} maxValue={100000} value={count} onChange={setCount} isRequired /></Tabs.Panel>
                <Tabs.Panel id="date" className="pt-3"><CalendarField label="截止日期（含当天）" value={endDate} onChange={setEndDate} timeZone={timeZone} dateOnly /></Tabs.Panel>
                <Tabs.Panel id="never" className="pt-3 text-sm text-muted">持续排期，直到暂停或归档。</Tabs.Panel>
              </Tabs>
            </section>}

            <Pick label="投递设备" value={deviceId} onChange={setDeviceId} options={(devices?.devices ?? [{ id: "default", name: "默认设备" }]).map((device) => ({ value: device.id, label: device.name }))} />
            {dashboard && !dashboard.deviceKeyConfigured && deviceId === "default" && <Notice kind="info" action={<Link href="/settings" className="workspace-link">前往设置</Link>}>默认设备未连接。</Notice>}

            <section className="grid gap-2 rounded-xl bg-surface-secondary p-4 text-sm">
              <div className="preview-title flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">接下来的提醒</h3><code className="text-xs text-muted">{generatedCron || "—"}</code></div>
              <p className="text-xs text-muted">显示时区：{dashboard?.displayTimeZone ?? SCHEDULE_TIME_ZONE}</p>
              <div className="min-h-5" aria-live="polite">
                {preview.key !== previewKey ? <p className="text-muted">正在计算排期…</p> : preview.error ? <p className="text-danger-soft-foreground">{preview.error}</p> : !preview.dates.length ? <p className="text-muted">没有剩余排期。</p> : <ol className="list-decimal space-y-1 ps-5 tabular-nums">{preview.dates.slice(0, 3).map((date) => <li key={date}><time dateTime={date}>{formatTime(date)}</time></li>)}</ol>}
              </div>
            </section>

            <Details title="时区、节假日与通知策略">
              <Field label="排期时区" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required hint="IANA 时区，例如 Asia/Shanghai 或 UTC。" />
              <Field label="跳过日期" value={skipDates} onChange={(event) => setSkipDates(event.target.value)} hint="填写 YYYY-MM-DD，多个日期用逗号分隔。" />
              {preset === "weekdays" && <Field label="补班日期" value={includeDates} onChange={(event) => setIncludeDates(event.target.value)} hint="补充周末工作日，沿用开始时间的时分。" />}
              <NumericField label="允许延迟（分钟）" minValue={1} maxValue={525600} value={lateness} onChange={setLateness} hint="可留空；永久错误仍须手动处理。" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="任务通知分组" value={group} onChange={(event) => setGroup(event.target.value)} maxLength={100} placeholder="使用全局设置" />
                <Field label="任务提示音" value={sound} onChange={(event) => setSound(event.target.value)} maxLength={80} placeholder="使用全局设置" />
              </div>
              <section className="space-y-2 rounded-xl bg-surface-secondary p-4 text-sm">
                <h3 className="text-xs font-medium text-muted">通知预览</h3>
                <p className="line-clamp-1 font-semibold break-words">{name || "提醒名称"}</p>
                <p className="line-clamp-3 break-words whitespace-pre-line text-muted">{description || "计划提醒时间已到。"}</p>
                <p className="line-clamp-1 text-xs break-words text-muted">分组：{group || "全局设置"} · 提示音：{sound || "全局设置"}</p>
              </section>
            </Details>
          </Modal.Body>

          <Modal.Footer className="shrink-0 px-5 pb-5 sm:px-6">
            <Button type="button" variant="ghost" isDisabled={busy} onPress={close}>取消</Button>
            <Button type="submit" isPending={busy}>{editing ? "保存修改" : "创建提醒"}</Button>
          </Modal.Footer>
        </Form>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
    {discardChanges && <Confirm title="放弃尚未保存的修改？" confirmLabel="放弃修改" cancelLabel="继续编辑" onClose={() => setDiscardChanges(false)} onConfirm={onClose}>
      <p>关闭后，这次对提醒表单的修改将不会保留。</p>
    </Confirm>}
  </>;
}
