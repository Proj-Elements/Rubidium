"use client";

import { Button, Card, Fieldset, Form } from "@heroui/react";
import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
import type { Device } from "@/lib/types";
import { CardHeading, Confirm, Empty, Field, IconButton, Loading, Notice } from "./primitives";
import { useResource } from "./use-resource";
import { useUnsaved } from "./use-unsaved";

type DeviceDraft = Pick<Device, "name" | "endpoint"> & Partial<Pick<Device, "id" | "revision">> & { deviceKey: string };

const empty: DeviceDraft = { name: "", endpoint: "https://api.day.app", deviceKey: "" };

export function DeviceManager() {
  const { data, error, refresh } = useResource<{ devices: Device[] }>("/api/devices", 15_000);
  const [form, setForm] = useState(empty);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: "edit" | "delete"; device: Device } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const devices = data?.devices.filter((device) => device.id !== "default") ?? [];
  useUnsaved(dirty);

  function update(field: "name" | "endpoint" | "deviceKey", value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setFeedback(null);
  }

  function reset() {
    setForm(empty);
    setDirty(false);
    setFeedback(null);
  }

  function edit({ id, name, endpoint, revision }: Device) {
    setForm({ id, name, endpoint, revision, deviceKey: "" });
    setDirty(false);
    setFeedback(null);
    setConfirmation(null);
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("save");
    setFeedback(null);
    try {
      await api("/api/devices", { method: "POST", body: JSON.stringify(form) });
      reset();
      setFeedback({ message: "设备已保存。", kind: "success" });
      await refresh();
    } catch (error) { setFeedback({ message: errorMessage(error), kind: "error" }); }
    finally { setBusy(null); }
  }

  async function deleteDevice(device: Device) {
    setBusy("delete");
    setFeedback(null);
    try {
      await api(`/api/devices?id=${encodeURIComponent(device.id)}`, { method: "DELETE", headers: { "if-match": String(device.revision) } });
      if (form.id === device.id) reset();
      setFeedback({ message: "设备已删除。", kind: "success" });
      await refresh();
    } catch (error) { setFeedback({ message: errorMessage(error), kind: "error" }); }
    finally { setConfirmation(null); setBusy(null); }
  }

  return <div className="grid items-start gap-5 lg:grid-cols-2">
    <Card className="min-w-0 gap-5 rounded-lg p-5 sm:p-6">
      <CardHeading title={form.id ? "编辑设备" : "添加设备"} description="设备可独立配置 Bark 服务地址和密钥。" />
      <Form onSubmit={save}>
        <Fieldset className="min-w-0 gap-4" disabled={busy !== null}>
          <Fieldset.Group>
            <Field ref={nameInput} label="设备名称" value={form.name} onChange={(event) => update("name", event.target.value)} maxLength={80} required />
            <Field label="设备服务地址" value={form.endpoint} onChange={(event) => update("endpoint", event.target.value)} type="url" maxLength={300} required />
            <Field label="设备密钥" value={form.deviceKey} onChange={(event) => update("deviceKey", event.target.value)} type="password" autoComplete="new-password" maxLength={300} required={!form.id} hint={form.id ? "服务地址不变时，留空保留已有密钥。" : "密钥只在服务端保存，不会回显。"} />
          </Fieldset.Group>
          {feedback && <Notice kind={feedback.kind}>{feedback.message}</Notice>}
          <Fieldset.Actions className="justify-end">
            <Button type="button" variant="ghost" isDisabled={busy !== null || (!form.id && !dirty)} onPress={reset}>取消</Button>
            <Button type="submit" isPending={busy === "save"} isDisabled={busy === "delete"}>{form.id ? "保存设备" : "添加设备"}</Button>
          </Fieldset.Actions>
        </Fieldset>
      </Form>
    </Card>
    <Card className="min-w-0 gap-4 rounded-lg p-5 sm:p-6">
      <CardHeading title="其他 Bark 设备" description="为提醒选择设备时，默认设备和这里的设备均可使用。" />
      {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
      {devices.length ? <ul className="grid gap-2" aria-label="其他 Bark 设备">
        {devices.map((device) => <li key={device.id} className="flex items-center gap-2 border-b border-separator py-3 last:border-0">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{device.name}</p>
            <p className="text-xs text-muted [overflow-wrap:anywhere]">{device.endpoint}</p>
          </div>
          <IconButton icon="edit" label={`编辑 ${device.name}`} variant="outline" isDisabled={busy !== null} onPress={() => dirty ? setConfirmation({ kind: "edit", device }) : edit(device)} />
          <IconButton icon="trash" label={`删除 ${device.name}`} variant="danger-soft" isDisabled={busy !== null} onPress={() => setConfirmation({ kind: "delete", device })} />
        </li>)}
      </ul> : data ? <Empty title="还没有其他设备" description="添加后，可在编辑提醒时选择推送到哪台设备。" /> : !error && <Loading>正在读取设备</Loading>}
    </Card>
    {confirmation?.kind === "edit" && <Confirm title="放弃当前设备的修改？" confirmLabel="放弃并编辑" onClose={() => setConfirmation(null)} onConfirm={() => edit(confirmation.device)}>
      <p>当前草稿不会保存，将改为编辑「{confirmation.device.name}」。</p>
    </Confirm>}
    {confirmation?.kind === "delete" && <Confirm title={`删除设备「${confirmation.device.name}」？`} confirmLabel="删除设备" onClose={() => setConfirmation(null)} onConfirm={() => void deleteDevice(confirmation.device)} busy={busy === "delete"}>
      <p>仍被任务或队列引用的设备不能删除。</p>
    </Confirm>}
  </div>;
}
