"use client";

import { Button, Card, Dropdown, Label, Table } from "@heroui/react";
import { useState } from "react";
import { Glyph } from "@/components/icons";
import { Confirm, Empty, IconButton, Loading, Notice, PageHeading, TaskBadge } from "@/components/primitives";
import { Pagination } from "@/components/pagination";
import { BulkActions, RecordList, useRecordQuery } from "@/components/record-list";
import { Selection } from "@/components/selection";
import { useResource } from "@/components/use-resource";
import { useWorkspace } from "@/components/workspace-context";
import type { Task } from "@/lib/types";
import { api, errorMessage, PRESET_LABELS } from "@/lib/ui";
import { useTime } from "@/components/use-time";

const filters = [
  { id: "all", label: "全部提醒" },
  { id: "active", label: "进行中" },
  { id: "paused", label: "已暂停" },
  { id: "completed", label: "排期结束" },
  { id: "archived", label: "已归档" },
];
const PAGE_SIZE = 10;

export default function TasksPage() {
  const { openTask, refresh: refreshDashboard, notify } = useWorkspace();
  const { filter, setFilter, setPage, query, setQuery, search, params } = useRecordQuery(PAGE_SIZE);
  const [archive, setArchive] = useState<Task | null>(null);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [destroy, setDestroy] = useState<Task | null>(null);
  const [confirmBulkArchive, setConfirmBulkArchive] = useState(false);
  const { data, error, refresh } = useResource<{ tasks: Task[]; total: number; page: number }>(`/api/tasks?${params}`);
  const selectedTasks = data?.tasks.filter((task) => selected.includes(task.id)) ?? [];
  const canPause = selectedTasks.some((task) => task.status === "active");
  const canResume = selectedTasks.some((task) => task.status === "paused" || task.status === "archived");
  const canArchive = selectedTasks.some((task) => task.status !== "archived");

  async function toggle(task: Task) {
    setBusy(task.id);
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH", body: JSON.stringify({ status: task.status === "paused" ? "active" : "paused", revision: task.revision }),
      });
      notify(task.status === "paused" ? "提醒已恢复，暂停期间不会补发。" : "提醒已暂停，已排队的消息会继续投递。");
      await refresh();
      void refreshDashboard();
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function archiveTask() {
    if (!archive) return;
    setBusy(archive.id);
    try {
      await api(`/api/tasks/${archive.id}`, { method: "DELETE", headers: { "if-match": String(archive.revision) } });
      setArchive(null);
      notify("提醒已归档。投递记录和待发送消息均已保留。");
      await refresh();
      void refreshDashboard();
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function bulk(status: "active" | "paused" | "archived") {
    const items = selectedTasks.filter((task) => status === "paused" ? task.status === "active"
      : status === "active" ? task.status === "paused" || task.status === "archived" : task.status !== "archived")
      .map(({ id, revision }) => ({ id, revision }));
    if (!items.length) { setConfirmBulkArchive(false); return; }
    setBusy("bulk");
    try {
      const result = await api<{ results: Array<{ success: boolean; error?: string }> }>("/api/tasks", { method: "PATCH", body: JSON.stringify({ status, items }) });
      const failures = result.results.filter((item) => !item.success);
      notify(failures.length ? failures.map((item) => item.error).join("；") : "批量操作完成", failures.length ? "error" : "success");
      setSelected([]); await Promise.all([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error), "error"); }
    finally { setConfirmBulkArchive(false); setBusy(""); }
  }

  async function restore(task: Task) {
    setBusy(task.id);
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "active", revision: task.revision }) });
      notify("提醒已恢复，归档期间不会补发。");
      await Promise.all([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error), "error"); }
    finally { setBusy(""); }
  }

  async function removePermanently() {
    if (!destroy) return;
    setBusy(destroy.id);
    try {
      await api(`/api/tasks/${destroy.id}?permanent=1`, { method: "DELETE", headers: { "if-match": String(destroy.revision) } });
      setDestroy(null); notify("任务及其投递记录已永久删除。");
      await Promise.all([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error), "error"); }
    finally { setBusy(""); }
  }

  const selectPage = <Selection label="选择本页提醒" selected={Boolean(data?.tasks.length && selectedTasks.length === data.tasks.length)} partial={selectedTasks.length > 0 && selectedTasks.length !== data?.tasks.length} disabled={Boolean(busy)} onChange={(value) => setSelected(value ? data?.tasks.map((task) => task.id) ?? [] : [])} />;
  function selectTask(task: Task) {
    return <Selection label={`选择 ${task.name}`} selected={selected.includes(task.id)} disabled={Boolean(busy)} onChange={(value) => setSelected((current) => value ? [...current, task.id] : current.filter((id) => id !== task.id))} />;
  }
  function taskActions(task: Task) {
    return <TaskActions task={task} busy={Boolean(busy)} onToggle={() => void toggle(task)} onArchive={() => setArchive(task)} onRestore={() => void restore(task)} onDelete={() => setDestroy(task)} />;
  }

  return (
    <div className="grid gap-6 pb-12">
      <PageHeading title="所有提醒" description="管理提醒的排期、重复规则与投递设备。" action={<Button onPress={() => openTask()}><Glyph name="plus" />新建提醒</Button>} />
      <RecordList label="提醒状态" searchLabel="搜索提醒" filters={filters} filter={filter} query={query}
        onFilter={(value) => { setFilter(value); setSelected([]); }} onSearch={(value) => { setQuery(value); setSelected([]); }}>
        {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
        {!data ? !error && <Loading>正在读取提醒</Loading> : !data.tasks.length ? <Card className="rounded-2xl">
          <Empty title={search ? "没有匹配的提醒" : "暂无提醒"} description={search ? "试试其他关键词，或切换提醒状态。" : filter === "all" ? "创建提醒后，可以在这里管理排期。" : "当前状态下没有提醒。"} />
        </Card> : <>
          <Card className="hidden min-w-0 gap-4 rounded-2xl p-4 md:flex">
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="提醒列表">
                  <Table.Header>
                    <Table.Column aria-label="选择" className="w-12 whitespace-nowrap">{selectPage}</Table.Column>
                    <Table.Column isRowHeader className="min-w-36">提醒事项</Table.Column>
                    <Table.Column className="whitespace-nowrap">下次排期</Table.Column>
                    <Table.Column className="whitespace-nowrap">投递计数</Table.Column>
                    <Table.Column className="whitespace-nowrap">状态</Table.Column>
                    <Table.Column aria-label="操作" className="w-24" />
                  </Table.Header>
                  <Table.Body>
                    {data.tasks.map((task) => <Table.Row key={task.id} id={task.id}>
                      <Table.Cell>{selectTask(task)}</Table.Cell>
                      <Table.Cell className="max-w-60"><TaskName task={task} /></Table.Cell>
                      <Table.Cell className="whitespace-nowrap"><TaskSchedule task={task} /></Table.Cell>
                      <Table.Cell className="whitespace-nowrap"><TaskCounts task={task} /></Table.Cell>
                      <Table.Cell><TaskBadge task={task} /></Table.Cell>
                      <Table.Cell>{taskActions(task)}</Table.Cell>
                    </Table.Row>)}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>
          <div className="grid gap-3 md:hidden">
            <div className="flex items-center gap-2 px-2 text-sm text-muted">{selectPage}<span aria-hidden="true">选择本页</span></div>
            <ul className="grid gap-3">
              {data.tasks.map((task) => <li key={task.id}>
                <Card className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-2xl p-4">
                  {selectTask(task)}
                  <div className="min-w-0 space-y-3">
                    <TaskName task={task} />
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"><TaskSchedule task={task} /><TaskBadge task={task} /></div>
                    <div className="flex flex-wrap items-center justify-between gap-2"><TaskCounts task={task} />{taskActions(task)}</div>
                  </div>
                </Card>
              </li>)}
            </ul>
          </div>
          <Pagination page={data.page} total={data.total} pageSize={PAGE_SIZE} onChange={(value) => { setPage(value); setSelected([]); }} />
        </>}
      </RecordList>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted"><Glyph name="shield" size={16} />暂停和归档只停止后续排期，已排队消息仍会投递。</p>
      <BulkActions count={selectedTasks.length} disabled={Boolean(busy)} onClear={() => setSelected([])}>
        <Button variant="ghost" isDisabled={!canPause || Boolean(busy)} onPress={() => void bulk("paused")}>暂停</Button>
        <Button variant="ghost" isDisabled={!canResume || Boolean(busy)} onPress={() => void bulk("active")}>恢复</Button>
        <Button variant="danger-soft" isDisabled={!canArchive || Boolean(busy)} onPress={() => setConfirmBulkArchive(true)}>归档</Button>
      </BulkActions>
      {archive && (
        <Confirm title={`归档「${archive.name}」？`} confirmLabel="确认归档" onClose={() => setArchive(null)} onConfirm={() => void archiveTask()} busy={busy === archive.id}>
          <p>未来的排期将停止。已经到期的提醒会继续投递，全部历史记录都会保留，你也可以随时复制为新提醒。</p>
        </Confirm>
      )}
      {confirmBulkArchive && <Confirm title="归档选中的提醒？" confirmLabel="确认批量归档" onClose={() => setConfirmBulkArchive(false)} onConfirm={() => void bulk("archived")} busy={busy === "bulk"}>
        <p>这些提醒的未来排期将停止，已到期的消息和历史记录会保留。</p>
      </Confirm>}
      {destroy && <Confirm title={`永久删除「${destroy.name}」？`} confirmLabel="永久删除" onClose={() => setDestroy(null)} onConfirm={() => void removePermanently()} busy={busy === destroy.id}><p>任务、待投递消息和全部尝试历史都会删除，此操作无法撤销。</p></Confirm>}
    </div>
  );
}

function TaskName({ task }: { task: Task }) {
  return <div className="min-w-0 space-y-1">
    <strong className="line-clamp-2 text-sm font-semibold break-words">{task.name}</strong>
    {task.description && <p className="line-clamp-2 text-xs leading-relaxed break-words text-muted">{task.description}</p>}
    {task.lastError && <p className="line-clamp-2 text-xs break-words text-warning-soft-foreground">{task.pendingCount > 0 ? "有消息等待处理" : task.lastError}</p>}
  </div>;
}

function TaskSchedule({ task }: { task: Task }) {
  const { formatTime } = useTime();
  return <div className="space-y-1 text-sm tabular-nums">
    {task.status === "active" && task.nextRunAt ? <time dateTime={task.nextRunAt}>{formatTime(task.nextRunAt)}</time> : <p>{task.status === "paused" ? "恢复后继续" : "—"}</p>}
    <p className="text-xs text-muted">{PRESET_LABELS[task.preset]} · {task.timeZone}</p>
    {task.preset === "custom" && <code className="text-xs text-muted">{task.cron}</code>}
  </div>;
}

function TaskCounts({ task }: { task: Task }) {
  return <div className="space-y-1 text-xs text-muted tabular-nums">
    <p className="text-sm text-foreground">{task.sentCount} 次已接收</p>
    <p>排期 {task.queuedCount}{task.repeatCount ? ` / ${task.repeatCount}` : task.endDate ? ` · 截至 ${task.endDate}` : ""}</p>
    {task.pendingCount > 0 && <p>{task.pendingCount} 条待投递</p>}
  </div>;
}

function TaskActions({ task, busy, onToggle, onArchive, onRestore, onDelete }: { task: Task; busy: boolean; onToggle: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void }) {
  const { openTask } = useWorkspace();
  const editable = task.status === "active" || task.status === "paused";
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {editable && <IconButton label={`编辑 ${task.name}`} icon="edit" onPress={() => openTask(task)} isDisabled={busy} />}
      <Dropdown>
        <IconButton label={`更多操作 ${task.name}`} icon="more" isDisabled={busy} />
        <Dropdown.Popover>
          <Dropdown.Menu aria-label={`${task.name}的操作`} onAction={(key) => {
            if (key === "toggle") onToggle();
            if (key === "copy") openTask(task, true);
            if (key === "archive") onArchive();
            if (key === "restore") onRestore();
            if (key === "delete") onDelete();
          }}>
            {editable && <Dropdown.Item id="toggle" textValue={task.status === "paused" ? "恢复提醒" : "暂停提醒"}>
              <Glyph name={task.status === "paused" ? "play" : "pause"} /><Label>{task.status === "paused" ? "恢复提醒" : "暂停提醒"}</Label>
            </Dropdown.Item>}
            <Dropdown.Item id="copy" textValue="复制为新提醒"><Glyph name="copy" /><Label>复制为新提醒</Label></Dropdown.Item>
            {task.status !== "archived" && <Dropdown.Item id="archive" textValue="归档提醒"><Glyph name="archive" /><Label>归档提醒</Label></Dropdown.Item>}
            {task.status === "archived" && <Dropdown.Item id="restore" textValue="恢复归档提醒"><Glyph name="play" /><Label>恢复归档提醒</Label></Dropdown.Item>}
            {task.status === "archived" && <Dropdown.Item id="delete" textValue="永久删除" variant="danger"><Glyph name="trash" /><Label>永久删除</Label></Dropdown.Item>}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
