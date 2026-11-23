"use client";

import { Button, Card, Dropdown, Label } from "@heroui/react";
import { DataGrid, ListView, type DataGridColumn } from "@heroui-pro/react";
import { useState } from "react";
import { Glyph } from "@/components/icons";
import { Confirm, Empty, IconButton, Loading, Notice, PageHeading, TaskBadge } from "@/components/primitives";
import { Pagination } from "@/components/pagination";
import { BulkActions, RecordList, useRecordQuery } from "@/components/record-list";
import { Selection } from "@/components/selection";
import { useResource } from "@/components/use-resource";
import { useWorkspace } from "@/components/workspace-context";
import type { Task } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";
import { useTime } from "@/components/use-time";
import { useTranslations } from "@/components/locale-provider";
import { presetMessageKeys } from "@/lib/i18n";

const PAGE_SIZE = 10;

export default function TasksPage() {
  const { t, locale } = useTranslations();
  const filters = [
    { value: "all", label: t("delivery.filterAll") },
    { value: "active", label: t("taskStatus.active") },
    { value: "paused", label: t("taskStatus.paused") },
    { value: "completed", label: t("taskStatus.completed") },
    { value: "archived", label: t("taskStatus.archived") },
  ];
  const { refresh: refreshDashboard, notify, openTask } = useWorkspace();
  const { filter, setFilter, setPage, query, setQuery, search, params, selected, setSelected, clearFilters } = useRecordQuery(PAGE_SIZE, filters);
  const [archive, setArchive] = useState<Task | null>(null);
  const [busy, setBusy] = useState("");
  const [destroy, setDestroy] = useState<Task | null>(null);
  const [confirmBulkArchive, setConfirmBulkArchive] = useState(false);
  const { data, error, refresh } = useResource<{ tasks: Task[]; total: number; page: number }>(`/api/tasks?${params}`);
  const filtered = Boolean(search) || filter !== "all";
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
      notify(task.status === "paused" ? t("taskStatus.resumedToast") : t("taskStatus.pausedToast"));
      await refresh();
      void refreshDashboard();
    } catch (error) {
      notify(errorMessage(error, locale), "error");
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
      notify(t("taskStatus.archivedToast"));
      await refresh();
      void refreshDashboard();
    } catch (error) {
      notify(errorMessage(error, locale), "error");
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
      notify(failures.length ? failures.map((item) => item.error).join("; ") : t("taskStatus.bulkDone"), failures.length ? "error" : "success");
      setSelected([]); await Promise.all([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error, locale), "error"); }
    finally { setConfirmBulkArchive(false); setBusy(""); }
  }

  async function restore(task: Task) {
    setBusy(task.id);
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "active", revision: task.revision }) });
      notify(t("taskStatus.restored"));
      await Promise.all([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error, locale), "error"); }
    finally { setBusy(""); }
  }

  async function removePermanently() {
    if (!destroy) return;
    setBusy(destroy.id);
    try {
      await api(`/api/tasks/${destroy.id}?permanent=1`, { method: "DELETE", headers: { "if-match": String(destroy.revision) } });
      setDestroy(null); notify(t("taskStatus.deleted"));
      await Promise.all([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error, locale), "error"); }
    finally { setBusy(""); }
  }

  const selectPage = <Selection text={t("taskStatus.selectPage")} selected={Boolean(data?.tasks.length && selectedTasks.length === data.tasks.length)} partial={selectedTasks.length > 0 && selectedTasks.length !== data?.tasks.length} disabled={Boolean(busy)} onChange={(value) => setSelected(value ? data?.tasks.map((task) => task.id) ?? [] : [])} />;
  function taskActions(task: Task) {
    return <TaskActions task={task} busy={Boolean(busy)} onToggle={() => void toggle(task)} onArchive={() => setArchive(task)} onRestore={() => void restore(task)} onDelete={() => setDestroy(task)} />;
  }
  const columns: DataGridColumn<Task>[] = [
    { id: "name", header: t("taskStatus.tableName"), isRowHeader: true, minWidth: 200, cell: (task) => <TaskName task={task} /> },
    { id: "schedule", header: t("taskStatus.nextRun"), minWidth: 195, cell: (task) => <TaskSchedule task={task} /> },
    { id: "counts", header: t("taskStatus.deliveryCount"), minWidth: 140, cell: (task) => <TaskCounts task={task} /> },
    { id: "status", header: t("taskStatus.status"), width: 110, cell: (task) => <TaskBadge task={task} /> },
    { id: "actions", header: <span className="sr-only">{t("common.actions")}</span>, width: 100, pinned: "end", cell: taskActions },
  ];

  return (
    <div className="grid gap-6 pb-12">
      <PageHeading title={t("page.reminders")} />
      <RecordList label={t("taskStatus.filter")} searchLabel={t("taskStatus.search")} filters={filters} filter={filter} query={query} onFilter={setFilter} onSearch={setQuery}>
        {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("common.retry")}</Button>}>{error}</Notice>}
        {!data ? !error && <Loading>{t("taskStatus.loading")}</Loading> : !data.tasks.length ? <Card>
          <Empty title={filtered ? t("taskStatus.noMatching") : t("taskStatus.empty")}
            icon={filtered ? "search" : "calendar"} action={filtered ? <Button variant="outline" onPress={clearFilters}>{t("taskStatus.clearFilters")}</Button> : <Button onPress={() => openTask()}>{t("reminder.create")}</Button>} />
        </Card> : <>
          <DataGrid aria-label={t("taskStatus.reminderList")} className="hidden @min-[54rem]/records:block" data={data.tasks} columns={columns} getRowId={(task) => task.id}
            selectionMode="multiple" showSelectionCheckboxes selectedKeys={new Set(selectedTasks.map(({ id }) => id))}
            disabledKeys={busy ? data.tasks.map(({ id }) => id) : undefined}
            onSelectionChange={(keys) => setSelected(keys === "all" ? data.tasks.map(({ id }) => id) : [...keys].map(String))} />
          <div className="grid gap-3 @min-[54rem]/records:hidden">
            <div className="px-2">{selectPage}</div>
            <ListView aria-label={t("taskStatus.reminderList")} items={data.tasks} selectionMode="multiple" selectedKeys={selectedTasks.map(({ id }) => id)}
              disabledKeys={busy ? data.tasks.map(({ id }) => id) : undefined}
              onSelectionChange={(keys) => setSelected(keys === "all" ? data.tasks.map(({ id }) => id) : [...keys].map(String))}>
              {(task) => <ListView.Item id={task.id} textValue={task.name} className="items-start p-4">
                <ListView.ItemContent className="min-w-0 flex-1">
                  <div className="w-full min-w-0 space-y-3">
                    <TaskName task={task} />
                    <div className="flex flex-wrap items-start justify-between gap-3"><TaskSchedule task={task} /><TaskBadge task={task} /></div>
                    <div className="flex flex-wrap items-center justify-between gap-2"><TaskCounts task={task} />{taskActions(task)}</div>
                  </div>
                </ListView.ItemContent>
              </ListView.Item>}
            </ListView>
          </div>
          <Pagination page={data.page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>}
      </RecordList>
      <BulkActions count={selectedTasks.length} disabled={Boolean(busy)} onClear={() => setSelected([])}>
        <Button size="sm" variant="ghost" isDisabled={!canPause || Boolean(busy)} onPress={() => void bulk("paused")}>{t("taskStatus.pause")}</Button>
        <Button size="sm" variant="ghost" isDisabled={!canResume || Boolean(busy)} onPress={() => void bulk("active")}>{t("taskStatus.resume")}</Button>
        <Button size="sm" variant="danger-soft" isDisabled={!canArchive || Boolean(busy)} onPress={() => setConfirmBulkArchive(true)}>{t("taskStatus.archive")}</Button>
      </BulkActions>
      {archive && (
        <Confirm title={t("taskStatus.archiveTitle", { name: archive.name })} confirmLabel={t("taskStatus.archiveConfirm")} onClose={() => setArchive(null)} onConfirm={() => void archiveTask()} busy={busy === archive.id}>
          <p>{t("taskStatus.archiveDescription")}</p>
        </Confirm>
      )}
      {confirmBulkArchive && <Confirm title={t("taskStatus.bulkArchiveTitle")} confirmLabel={t("taskStatus.bulkArchiveConfirm")} onClose={() => setConfirmBulkArchive(false)} onConfirm={() => void bulk("archived")} busy={busy === "bulk"}>
        <p>{t("taskStatus.bulkArchiveDescription")}</p>
      </Confirm>}
      {destroy && <Confirm title={t("taskStatus.deleteTitle", { name: destroy.name })} confirmLabel={t("taskStatus.delete")} onClose={() => setDestroy(null)} onConfirm={() => void removePermanently()} busy={busy === destroy.id}><p>{t("taskStatus.deleteDescription")}</p></Confirm>}
    </div>
  );
}

function TaskName({ task }: { task: Task }) {
  const { t } = useTranslations();
  return <div className="min-w-0 space-y-1">
    <strong className="line-clamp-2 text-sm font-semibold break-words">{task.name}</strong>
    {task.description && <p className="line-clamp-2 text-xs leading-relaxed break-words text-muted">{task.description}</p>}
    {task.lastError && <p className="line-clamp-2 text-xs break-words text-warning-soft-foreground">{task.pendingCount > 0 ? t("taskStatus.messagesWaiting") : task.lastError}</p>}
  </div>;
}

function TaskSchedule({ task }: { task: Task }) {
  const { formatTime } = useTime();
  const { t } = useTranslations();
  return <div className="space-y-1 text-sm tabular-nums">
    {task.status === "active" && task.nextRunAt ? <time dateTime={task.nextRunAt}>{formatTime(task.nextRunAt)}</time> : <p>{task.status === "paused" ? t("taskStatus.resumeAfterPause") : "—"}</p>}
    <p className="text-xs text-muted">{t(presetMessageKeys[task.preset])} · {task.timeZone}</p>
    {task.preset === "custom" && <code className="text-xs text-muted">{task.cron}</code>}
  </div>;
}

function TaskCounts({ task }: { task: Task }) {
  const { t } = useTranslations();
  return <div className="space-y-1 text-xs text-muted tabular-nums">
    <p className="text-sm text-foreground">{t("taskStatus.sentCount", { count: task.sentCount })}</p>
    <p>{task.repeatCount ? t("taskStatus.queuedOf", { queued: task.queuedCount, total: task.repeatCount }) : task.endDate ? `${t("taskStatus.queuedCount", { queued: task.queuedCount })}${t("taskStatus.endsAt", { date: task.endDate })}` : t("taskStatus.queuedCount", { queued: task.queuedCount })}</p>
    {task.pendingCount > 0 && <p>{t("taskStatus.pendingCount", { count: task.pendingCount })}</p>}
  </div>;
}

function TaskActions({ task, busy, onToggle, onArchive, onRestore, onDelete }: { task: Task; busy: boolean; onToggle: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void }) {
  const { t } = useTranslations();
  const { openTask } = useWorkspace();
  const editable = task.status === "active" || task.status === "paused";
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {editable && <IconButton label={t("taskStatus.editNamed", { name: task.name })} icon="edit" onPress={() => openTask(task)} isDisabled={busy} />}
      <Dropdown>
        <IconButton label={t("taskStatus.moreNamed", { name: task.name })} icon="more" isDisabled={busy} />
        <Dropdown.Popover>
          <Dropdown.Menu aria-label={t("taskStatus.moreNamed", { name: task.name })} onAction={(key) => {
            if (key === "toggle") onToggle();
            if (key === "copy") openTask(task, true);
            if (key === "archive") onArchive();
            if (key === "restore") onRestore();
            if (key === "delete") onDelete();
          }}>
            {editable && <Dropdown.Item id="toggle" textValue={task.status === "paused" ? t("taskStatus.resume") : t("taskStatus.pause")}>
              <Glyph name={task.status === "paused" ? "play" : "pause"} /><Label>{task.status === "paused" ? t("taskStatus.resume") : t("taskStatus.pause")}</Label>
            </Dropdown.Item>}
            <Dropdown.Item id="copy" textValue={t("taskStatus.copy")}><Glyph name="copy" /><Label>{t("taskStatus.copy")}</Label></Dropdown.Item>
            {task.status !== "archived" && <Dropdown.Item id="archive" textValue={t("taskStatus.archive")}><Glyph name="archive" /><Label>{t("taskStatus.archive")}</Label></Dropdown.Item>}
            {task.status === "archived" && <Dropdown.Item id="restore" textValue={t("taskStatus.restore")}><Glyph name="play" /><Label>{t("taskStatus.restore")}</Label></Dropdown.Item>}
            {task.status === "archived" && <Dropdown.Item id="delete" textValue={t("taskStatus.delete")} variant="danger"><Glyph name="trash" /><Label>{t("taskStatus.delete")}</Label></Dropdown.Item>}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
