"use client";

import { Button, Card, Chip, Drawer, Dropdown, Form, Label, Modal, ScrollShadow } from "@heroui/react";
import { useState, type FormEvent } from "react";
import { Glyph } from "@/components/icons";
import { AreaField, Confirm, DeliveryBadge, deliveryLabels, Details, Empty, Field, IconButton, Loading, Notice, PageHeading } from "@/components/primitives";
import { Pagination } from "@/components/pagination";
import { BulkActions, RecordList, useRecordQuery } from "@/components/record-list";
import { Selection } from "@/components/selection";
import { useResource } from "@/components/use-resource";
import { useTime } from "@/components/use-time";
import { useWorkspace } from "@/components/workspace-context";
import type { Delivery, DeliveryAttempt } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";

const filters = [
  { value: "all", label: "全部记录" },
  ...Object.entries(deliveryLabels).map(([value, label]) => ({ value, label: value === "sent" ? "已接收" : label })),
  { value: "retrying", label: "重试中" },
];
const PAGE_SIZE = 12;

export default function DeliveriesPage() {
  const { refresh: refreshDashboard, notify } = useWorkspace();
  const { filter, setFilter, setPage, query, setQuery, params, search, selected, setSelected, clearFilters } = useRecordQuery(PAGE_SIZE, filters);
  const [busy, setBusy] = useState("");
  const [cancel, setCancel] = useState<Delivery | null>(null);
  const [details, setDetails] = useState<Delivery | null>(null);
  const [edit, setEdit] = useState<Delivery | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const { data, error, refresh } = useResource<{ deliveries: Delivery[]; total: number; page: number }>(`/api/deliveries?${params}`);
  const filtered = Boolean(search) || filter !== "all";
  const pending = data?.deliveries.filter((item) => item.status === "pending") ?? [];
  const selectedIds = pending.filter((item) => selected.includes(item.id)).map((item) => item.id);

  async function mutate(item: Delivery, action: "retry" | "cancel") {
    setBusy(item.id);
    try {
      await api(`/api/deliveries/${item.id}/${action}`, { method: "POST", body: "{}" });
      setCancel(null);
      notify(action === "retry" ? "已提前加入投递队列；服务限流时仍会遵守等待时间。" : "已取消本条消息，记录已保留。未来排期不受影响。");
      await Promise.allSettled([refresh(), refreshDashboard()]);
    } catch (error) {
      setCancel(null);
      notify(errorMessage(error), "error");
    } finally { setBusy(""); }
  }

  async function bulk(action: "retry" | "cancel") {
    if (!selectedIds.length) { setBulkConfirm(false); return; }
    setBusy("bulk");
    try {
      const result = await api<{ results: Array<{ success: boolean }> }>("/api/deliveries", { method: "PATCH", body: JSON.stringify({ action, ids: selectedIds }) });
      const updated = result.results.filter((item) => item.success).length;
      notify(`已处理 ${updated} 条消息${updated < selectedIds.length ? "，状态已变化的记录已跳过" : ""}。`, updated ? "success" : "error");
      setSelected([]);
      await Promise.allSettled([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error), "error"); }
    finally { setBulkConfirm(false); setBusy(""); }
  }

  return <div className="grid gap-6 pb-12">
    <PageHeading title="投递记录" />
    <RecordList label="投递状态" searchLabel="搜索记录" filters={filters} filter={filter} query={query} onFilter={setFilter} onSearch={setQuery}>
      {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
      {!data ? !error && <Loading>正在读取投递记录</Loading> : !data.deliveries.length ? <Card className="rounded-lg">
        <Empty title={filtered ? "没有匹配的记录" : "暂无投递记录"} description={filtered ? "试试其他关键词，或切换投递状态。" : "提醒触发后，会在这里显示通知和尝试结果。"}
          icon={filtered ? "search" : "inbox"} action={filtered && <Button variant="outline" className="max-sm:min-h-11" onPress={clearFilters}>清除筛选</Button>} />
      </Card> : <>
        {pending.length > 0 && <div className="px-2">
          <Selection text="选择本页待投递消息" selected={selectedIds.length === pending.length} partial={selectedIds.length > 0 && selectedIds.length !== pending.length}
            disabled={Boolean(busy)} onChange={(value) => setSelected(value ? pending.map((item) => item.id) : [])} />
        </div>}
        <ul className="grid gap-3">
          {data.deliveries.map((item) => <li key={item.id}>
            <Card render={(props) => <article {...props} />} className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-3 rounded-lg p-4 sm:p-5">
              {item.status === "pending" ? <Selection label={`选择投递 ${item.taskName}`} selected={selectedIds.includes(item.id)} disabled={Boolean(busy)}
                onChange={(value) => setSelected((current) => value ? [...current, item.id] : current.filter((id) => id !== item.id))} /> : <Glyph name="send" size={17} className="mt-1 justify-self-center text-muted" />}
              <div className="grid min-w-0 gap-3">
                <Card.Header className="flex-row items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <Card.Title render={(props) => <h2 {...props} />} className="line-clamp-2 font-semibold break-words">{item.taskName}</Card.Title>
                    <DeliveryBadge item={item} />
                  </div>
                  {item.status === "pending" && <Dropdown>
                    <IconButton icon="more" label={`更多操作 ${item.taskName}`} isDisabled={Boolean(busy)} />
                    <Dropdown.Popover><Dropdown.Menu aria-label="投递操作" onAction={(key) => {
                      if (key === "edit") setEdit(item);
                      if (key === "cancel") setCancel(item);
                    }}>
                      <Dropdown.Item id="edit" textValue="修正消息内容"><Glyph name="edit" /><Label>修正消息内容</Label></Dropdown.Item>
                      <Dropdown.Item id="cancel" variant="danger" textValue="取消投递"><Glyph name="close" /><Label>取消投递</Label></Dropdown.Item>
                    </Dropdown.Menu></Dropdown.Popover>
                  </Dropdown>}
                </Card.Header>
                <Card.Content className="gap-2">
                  {item.description && <p className="line-clamp-2 text-sm leading-relaxed break-words text-muted">{item.description}</p>}
                  <DeliveryTimes item={item} />
                  {item.lastError && item.status !== "sent" && <p className="line-clamp-2 text-xs leading-relaxed break-words text-warning-soft-foreground">{item.lastError}</p>}
                </Card.Content>
                <Card.Footer className="flex-wrap gap-2">
                  <Button variant="ghost" onPress={() => setDetails(item)}>查看详情</Button>
                  {item.status === "pending" && item.attempts > 0 && <Button variant="outline" isPending={busy === item.id} isDisabled={Boolean(busy) && busy !== item.id} onPress={() => void mutate(item, "retry")}>立即重试</Button>}
                </Card.Footer>
              </div>
            </Card>
          </li>)}
        </ul>
        <Pagination page={data.page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      </>}
    </RecordList>

    <Details title="投递与重试规则">
      <div className="max-w-2xl space-y-2 text-sm leading-relaxed text-muted">
        <p>提醒到期后先进入持久队列。失败时按 5 秒至 1 小时退避，并遵守 Bark 的 Retry-After；已过期或取消的消息不再发送。</p>
        <p>「Bark 已接收」表示 API 已确认接收，不代表设备已展示通知。网络中断时重试可能产生重复通知。</p>
      </div>
    </Details>
    <BulkActions count={selectedIds.length} disabled={Boolean(busy)} onClear={() => setSelected([])}>
      <Button variant="ghost" isDisabled={Boolean(busy)} onPress={() => void bulk("retry")}>批量重试</Button>
      <Button variant="danger-soft" isDisabled={Boolean(busy)} onPress={() => setBulkConfirm(true)}>批量取消</Button>
    </BulkActions>

    {cancel && <Confirm title={`取消「${cancel.taskName}」这次投递？`} confirmLabel="取消投递" cancelLabel="保留投递" onClose={() => setCancel(null)} onConfirm={() => void mutate(cancel, "cancel")} busy={busy === cancel.id}>
      <p>只取消这条等待中的消息。消息历史会保留，任务未来的排期不受影响。</p>
    </Confirm>}
    {bulkConfirm && <Confirm title="取消选中的待投递消息？" confirmLabel="批量取消" cancelLabel="保留投递" onClose={() => setBulkConfirm(false)} onConfirm={() => void bulk("cancel")} busy={busy === "bulk"}>
      <p>只处理当前页选中的待投递消息。投递记录会保留。</p>
    </Confirm>}
    {edit && <DeliveryEditor item={edit} onClose={() => setEdit(null)} onSaved={() => {
      setEdit(null); notify("内容已修正，消息等待重试。"); void Promise.allSettled([refresh(), refreshDashboard()]);
    }} />}
    {details && <DeliveryDetails item={data?.deliveries.find((item) => item.id === details.id) ?? details} onClose={() => setDetails(null)} />}
  </div>;
}

function DeliveryTimes({ item }: { item: Delivery }) {
  const { formatTime } = useTime();
  const timing = item.status === "sent" ? { label: "接收于", value: item.deliveredAt }
    : item.status === "pending" && !item.manualOnly ? { label: "下次尝试", value: item.nextAttemptAt }
    : item.status === "cancelled" || item.status === "expired" ? { label: "更新于", value: item.updatedAt } : null;
  return <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-relaxed text-muted tabular-nums">
    <span>计划于 <time dateTime={item.occurrenceAt}>{formatTime(item.occurrenceAt)}</time></span>
    {timing?.value && <span>{timing.label} <time dateTime={timing.value}>{formatTime(timing.value)}</time></span>}
  </p>;
}

function DeliveryEditor({ item, onClose, onSaved }: { item: Delivery; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item.taskName);
  const [body, setBody] = useState(item.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`/api/deliveries/${item.id}`, { method: "PATCH", body: JSON.stringify({ title, body, updatedAt: item.updatedAt }) });
      onSaved();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
    <Modal.Container placement="center" scroll="inside"><Modal.Dialog>
      <Form onSubmit={save} className="flex min-h-0 flex-col">
        <Modal.Header><Modal.Heading>修正消息内容</Modal.Heading></Modal.Header>
        <Modal.Body className="grid content-start gap-4">
          {error && <Notice>{error}</Notice>}
          <Field label="消息标题" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required disabled={busy} />
          <AreaField label="消息正文" value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={4} disabled={busy} />
        </Modal.Body>
        <Modal.Footer><Button type="button" variant="ghost" isDisabled={busy} onPress={onClose}>取消</Button><Button type="submit" isPending={busy}>保存并重试</Button></Modal.Footer>
      </Form>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>;
}

function DeliveryDetails({ item, onClose }: { item: Delivery; onClose: () => void }) {
  const { formatTime } = useTime();
  const { data, error, refresh } = useResource<{ attempts: DeliveryAttempt[] }>(`/api/deliveries/${item.id}/attempts`, 5000);
  const names = { sending: "发送中", sent: "Bark 已接收", failed: "失败", interrupted: "结果未知" };

  return <Drawer.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }} isDismissable>
    <Drawer.Content placement="right"><Drawer.Dialog className="detail-drawer">
      <Drawer.Header className="flex-row items-start justify-between gap-2"><Drawer.Heading>投递详情</Drawer.Heading><IconButton icon="close" label="关闭投递详情" onPress={onClose} /></Drawer.Header>
      <Drawer.Body className="grid content-start gap-5">
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold break-words">{item.taskName}</h3><DeliveryBadge item={item} /></div>
          {item.description && <p className="leading-relaxed break-words whitespace-pre-wrap text-muted">{item.description}</p>}
          <DeliveryTimes item={item} />
          <p className="text-xs text-muted tabular-nums">已完成 {item.attempts} 次尝试{item.expiresAt ? ` · 到期 ${formatTime(item.expiresAt)}` : ""}</p>
          {item.lastError && item.status !== "sent" && <Notice kind="warning">{item.lastError}</Notice>}
          {item.status === "pending" && item.manualOnly && <p className="text-sm leading-relaxed text-muted">自动重试已停止。修正内容或设备配置后可手动重试。</p>}
        </div>
        <section className="grid gap-3" aria-label="尝试历史">
          <h3 className="font-semibold">尝试历史</h3>
          {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试读取</Button>}>{error}</Notice>}
          {!data ? !error && <Loading>正在读取尝试历史</Loading> : data.attempts.length ? <>
            <ScrollShadow className="max-h-[42dvh] overflow-y-auto" size={16}>
              <ol className="grid gap-4">
                {data.attempts.map((attempt) => <li key={attempt.id} className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Chip variant="soft" color={attempt.outcome === "failed" ? "danger" : attempt.outcome === "interrupted" ? "warning" : attempt.outcome === "sent" ? "success" : "default"}>
                      <Chip.Label>{names[attempt.outcome]}</Chip.Label>
                    </Chip>
                    <time className="text-xs text-muted tabular-nums" dateTime={attempt.startedAt}>{formatTime(attempt.startedAt)}</time>
                  </div>
                  {attempt.error && <p className="text-sm leading-relaxed break-words text-muted">{attempt.error}</p>}
                </li>)}
              </ol>
            </ScrollShadow>
            <p className="text-xs text-muted">显示最近 100 次尝试。</p>
          </> : <Empty title="暂无尝试历史" description="投递开始后会记录尝试结果。旧版记录可能只保留累计次数。" />}
        </section>
      </Drawer.Body>
    </Drawer.Dialog></Drawer.Content>
  </Drawer.Backdrop>;
}
