"use client";

import { Button, Card, Chip, Drawer, Dropdown, Form, Label, Modal, ScrollShadow, Tooltip } from "@heroui/react";
import { DataGrid, ListView, type DataGridColumn } from "@heroui-pro/react";
import { useState, type FormEvent } from "react";
import { Glyph } from "@/components/icons";
import { AreaField, Confirm, DeliveryBadge, deliveryLabelKeys, Empty, Field, IconButton, Loading, Notice, PageHeading } from "@/components/primitives";
import { Pagination } from "@/components/pagination";
import { BulkActions, RecordList, useRecordQuery } from "@/components/record-list";
import { Selection } from "@/components/selection";
import { useResource } from "@/components/use-resource";
import { useTime } from "@/components/use-time";
import { useWorkspace } from "@/components/workspace-context";
import type { Delivery, DeliveryAttempt } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui";
import { useTranslations } from "@/components/locale-provider";

const PAGE_SIZE = 12;

export default function DeliveriesPage() {
  const { t, locale } = useTranslations();
  const filters = [
    { value: "all", label: t("delivery.filterAll") },
    ...Object.entries(deliveryLabelKeys).map(([value, key]) => ({ value, label: t(key) })),
    { value: "retrying", label: t("deliveryStatus.retrying") },
  ];
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
      notify(action === "retry" ? t("delivery.retryQueued") : t("delivery.cancelledToast"));
      await Promise.allSettled([refresh(), refreshDashboard()]);
    } catch (error) {
      setCancel(null);
      notify(errorMessage(error, locale), "error");
    } finally { setBusy(""); }
  }

  async function bulk(action: "retry" | "cancel") {
    if (!selectedIds.length) { setBulkConfirm(false); return; }
    setBusy("bulk");
    try {
      const result = await api<{ results: Array<{ success: boolean }> }>("/api/deliveries", { method: "PATCH", body: JSON.stringify({ action, ids: selectedIds }) });
      const updated = result.results.filter((item) => item.success).length;
      notify(t("delivery.processed", { count: updated, partial: updated < selectedIds.length ? t("delivery.skippedChanged") : "" }), updated ? "success" : "error");
      setSelected([]);
      await Promise.allSettled([refresh(), refreshDashboard()]);
    } catch (error) { notify(errorMessage(error, locale), "error"); }
    finally { setBulkConfirm(false); setBusy(""); }
  }

  const selectPage = <Selection label={t("delivery.selectPage")} selected={pending.length > 0 && selectedIds.length === pending.length}
    partial={selectedIds.length > 0 && selectedIds.length !== pending.length} disabled={Boolean(busy) || !pending.length}
    onChange={(value) => setSelected(value ? pending.map((item) => item.id) : [])} />;
  const columns: DataGridColumn<Delivery>[] = [
    ...(pending.length ? [{ id: "selection", header: selectPage, width: 48, cell: (item: Delivery) => item.status === "pending" ? <Selection label={t("delivery.selectNamed", { name: item.taskName })}
      selected={selectedIds.includes(item.id)} disabled={Boolean(busy)}
      onChange={(value) => setSelected((current) => value ? [...current, item.id] : current.filter((id) => id !== item.id))} /> : null }] : []),
    { id: "name", header: t("delivery.reminder"), isRowHeader: true, minWidth: 190, cell: (item) => <div className="min-w-0 space-y-1">
      <p className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{item.taskName}</p>
      {item.description && <p className="line-clamp-1 text-xs text-muted">{item.description}</p>}
    </div> },
    { id: "time", header: t("delivery.times"), minWidth: 220, cell: (item) => <DeliveryTimes item={item} /> },
    { id: "status", header: t("delivery.status"), width: 145, cell: (item) => <DeliveryBadge item={item} /> },
    { id: "attempts", header: t("delivery.attempts"), width: 90, accessorKey: "attempts", cellClassName: "tabular-nums" },
    { id: "actions", header: <span className="sr-only">{t("common.actions")}</span>, width: 100, pinned: "end", cell: (item) => <div className="flex items-center justify-end gap-1">
      <IconButton icon="inbox" label={t("delivery.detailsNamed", { name: item.taskName })} onPress={() => setDetails(item)} />
      {item.status === "pending" && <DeliveryActions item={item} busy={Boolean(busy)} onEdit={() => setEdit(item)} onCancel={() => setCancel(item)} />}
    </div> },
  ];

  return <div className="grid gap-6 pb-12">
    <PageHeading title={t("page.deliveries")} />
    <RecordList label={t("delivery.filter")} searchLabel={t("delivery.search")} filters={filters} filter={filter} query={query} onFilter={setFilter} onSearch={setQuery}>
      {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("common.retry")}</Button>}>{error}</Notice>}
      {!data ? !error && <Loading>{t("delivery.loading")}</Loading> : !data.deliveries.length ? <Card>
        <Empty title={filtered ? t("delivery.noMatching") : t("delivery.empty")}
          icon={filtered ? "search" : "inbox"} action={filtered && <Button variant="outline" className="max-sm:min-h-11" onPress={clearFilters}>{t("taskStatus.clearFilters")}</Button>} />
      </Card> : <>
        {pending.length > 0 && <div className="px-2 @min-[58rem]/records:hidden">
          <Selection text={t("delivery.selectPage")} selected={selectedIds.length === pending.length} partial={selectedIds.length > 0 && selectedIds.length !== pending.length}
            disabled={Boolean(busy)} onChange={(value) => setSelected(value ? pending.map((item) => item.id) : [])} />
        </div>}
        <DataGrid aria-label={t("delivery.list")} className="hidden @min-[58rem]/records:block" data={data.deliveries} columns={columns} getRowId={(item) => item.id} />

        <ListView aria-label={t("delivery.list")} className="@min-[58rem]/records:hidden" items={data.deliveries}
          selectionMode="multiple" selectedKeys={selectedIds} disabledBehavior="selection"
          disabledKeys={data.deliveries.filter((item) => Boolean(busy) || item.status !== "pending").map((item) => item.id)}
          onSelectionChange={(keys) => setSelected(keys === "all" ? pending.map((item) => item.id) : [...keys].map(String))}>
          {(item) => <ListView.Item id={item.id} textValue={item.taskName} className={`items-start p-4 ${item.status === "pending" && !busy ? "delivery-selectable" : ""}`}>
            <ListView.ItemContent className="min-w-0 flex-1">
              <div className="grid w-full min-w-0 gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <ListView.Title className="line-clamp-2 whitespace-normal [overflow-wrap:anywhere]">{item.taskName}</ListView.Title>
                    <DeliveryBadge item={item} />
                  </div>
                  {item.status === "pending" && <DeliveryActions item={item} busy={Boolean(busy)} onEdit={() => setEdit(item)} onCancel={() => setCancel(item)} />}
                </div>
                <div className="grid gap-2">
                  {item.description && <p className="line-clamp-2 text-sm leading-relaxed break-words text-muted">{item.description}</p>}
                  <DeliveryTimes item={item} />
                  {item.lastError && item.status !== "sent" && <p className="line-clamp-2 text-xs leading-relaxed break-words text-warning-soft-foreground">{item.lastError}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onPress={() => setDetails(item)}>{t("delivery.details")}</Button>
                  {item.status === "pending" && item.attempts > 0 && <Button variant="outline" isPending={busy === item.id} isDisabled={Boolean(busy) && busy !== item.id} onPress={() => void mutate(item, "retry")}>{t("delivery.retry")}</Button>}
                </div>
              </div>
            </ListView.ItemContent>
          </ListView.Item>}
        </ListView>
        <Pagination page={data.page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      </>}
    </RecordList>

    <BulkActions count={selectedIds.length} disabled={Boolean(busy)} onClear={() => setSelected([])}>
      <Button size="sm" variant="ghost" isDisabled={Boolean(busy)} onPress={() => void bulk("retry")}>{t("delivery.retryMany")}</Button>
      <Button size="sm" variant="danger-soft" isDisabled={Boolean(busy)} onPress={() => setBulkConfirm(true)}>{t("delivery.cancelMany")}</Button>
    </BulkActions>

    {cancel && <Confirm title={t("delivery.cancelTitle", { name: cancel.taskName })} confirmLabel={t("delivery.cancel")} cancelLabel={t("delivery.keep")} onClose={() => setCancel(null)} onConfirm={() => void mutate(cancel, "cancel")} busy={busy === cancel.id}>
      <p>{t("delivery.cancelDescription")}</p>
    </Confirm>}
    {bulkConfirm && <Confirm title={t("delivery.cancelSelectedTitle")} confirmLabel={t("delivery.cancelMany")} cancelLabel={t("delivery.keep")} onClose={() => setBulkConfirm(false)} onConfirm={() => void bulk("cancel")} busy={busy === "bulk"}>
      <p>{t("delivery.cancelSelectedDescription")}</p>
    </Confirm>}
    {edit && <DeliveryEditor item={edit} onClose={() => setEdit(null)} onSaved={() => {
      setEdit(null); notify(t("delivery.editedToast")); void Promise.allSettled([refresh(), refreshDashboard()]);
    }} />}
    {details && <DeliveryDetails item={data?.deliveries.find((item) => item.id === details.id) ?? details} onClose={() => setDetails(null)} />}
  </div>;
}

function DeliveryActions({ item, busy, onEdit, onCancel }: { item: Delivery; busy: boolean; onEdit: () => void; onCancel: () => void }) {
  const { t } = useTranslations();
  return <Dropdown>
    <IconButton icon="more" label={t("delivery.moreNamed", { name: item.taskName })} isDisabled={busy} />
    <Dropdown.Popover><Dropdown.Menu aria-label={t("common.actions")} onAction={(key) => {
      if (key === "edit") onEdit();
      if (key === "cancel") onCancel();
    }}>
      <Dropdown.Item id="edit" textValue={t("delivery.editContent")}><Glyph name="edit" /><Label>{t("delivery.editContent")}</Label></Dropdown.Item>
      <Dropdown.Item id="cancel" variant="danger" textValue={t("delivery.cancel")}><Glyph name="close" /><Label>{t("delivery.cancel")}</Label></Dropdown.Item>
    </Dropdown.Menu></Dropdown.Popover>
  </Dropdown>;
}

function DeliveryTimes({ item }: { item: Delivery }) {
  const { formatTime } = useTime();
  const { t } = useTranslations();
  const timing = item.status === "sent" ? { label: "delivery.receivedAt" as const, value: item.deliveredAt }
    : item.status === "pending" && !item.manualOnly ? { label: "delivery.nextAttempt" as const, value: item.nextAttemptAt }
    : item.status === "cancelled" || item.status === "expired" ? { label: "delivery.updatedAt" as const, value: item.updatedAt } : null;
  return <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-relaxed text-muted tabular-nums">
    <span>{t("delivery.scheduledAt")}<time dateTime={item.occurrenceAt}>{formatTime(item.occurrenceAt)}</time></span>
    {timing?.value && <span>{t(timing.label)} <time dateTime={timing.value}>{formatTime(timing.value)}</time></span>}
  </p>;
}

function DeliveryEditor({ item, onClose, onSaved }: { item: Delivery; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useTranslations();
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
    } catch (error) { setError(errorMessage(error, locale)); }
    finally { setBusy(false); }
  }

  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy}>
    <Modal.Container placement="center" scroll="inside"><Modal.Dialog>
      <Form onSubmit={save} className="flex min-h-0 flex-col">
        <Modal.Header><Modal.Heading>{t("delivery.editContent")}</Modal.Heading></Modal.Header>
        <Modal.Body className="grid content-start gap-4">
          {error && <Notice>{error}</Notice>}
          <Field label={t("delivery.messageTitle")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required disabled={busy} />
          <AreaField label={t("delivery.messageBody")} value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={4} disabled={busy} />
        </Modal.Body>
        <Modal.Footer><Button type="button" variant="ghost" isDisabled={busy} onPress={onClose}>{t("common.cancel")}</Button><Button type="submit" isPending={busy}>{t("delivery.saveRetry")}</Button></Modal.Footer>
      </Form>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>;
}

function DeliveryDetails({ item, onClose }: { item: Delivery; onClose: () => void }) {
  const { formatTime } = useTime();
  const { t } = useTranslations();
  const { data, error, refresh } = useResource<{ attempts: DeliveryAttempt[] }>(`/api/deliveries/${item.id}/attempts`, 5000);
  const names = { sending: "deliveryStatus.sending", sent: "deliveryStatus.sent", failed: "delivery.attemptFailed", interrupted: "delivery.attemptUnknown" } as const;

  return <Drawer.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }} isDismissable>
    <Drawer.Content placement="right"><Drawer.Dialog className="detail-drawer">
      <Drawer.Header className="flex-row items-center justify-between gap-2">
        <Drawer.Heading>{t("delivery.details")}</Drawer.Heading>
        <Tooltip delay={350}>
          <Drawer.CloseTrigger aria-label={t("delivery.closeDetails")} className="static shrink-0 max-sm:size-11" />
          <Tooltip.Content>{t("delivery.closeDetails")}</Tooltip.Content>
        </Tooltip>
      </Drawer.Header>
      <Drawer.Body className="grid content-start gap-5">
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold break-words">{item.taskName}</h3><DeliveryBadge item={item} /></div>
          {item.description && <p className="leading-relaxed break-words whitespace-pre-wrap text-muted">{item.description}</p>}
          <DeliveryTimes item={item} />
          <p className="text-xs text-muted tabular-nums">{t("delivery.completedAttempts", { count: item.attempts })}{item.expiresAt ? t("delivery.expires", { time: formatTime(item.expiresAt) }) : ""}</p>
          {item.lastError && item.status !== "sent" && <Notice kind="warning">{item.lastError}</Notice>}
          {item.status === "pending" && item.manualOnly && <p className="text-sm leading-relaxed text-muted">{t("delivery.autoRetryStopped")}</p>}
        </div>
        <section className="grid gap-3" aria-label={t("delivery.attemptHistory")}>
          <h3 className="font-semibold">{t("delivery.attemptHistory")}</h3>
          {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("delivery.retryRead")}</Button>}>{error}</Notice>}
          {!data ? !error && <Loading>{t("delivery.retryRead")}</Loading> : data.attempts.length ? <>
            <ScrollShadow className="max-h-[42dvh] overflow-y-auto" size={16}>
              <ol className="grid gap-4">
                {data.attempts.map((attempt) => <li key={attempt.id} className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Chip variant="soft" color={attempt.outcome === "failed" ? "danger" : attempt.outcome === "interrupted" ? "warning" : attempt.outcome === "sent" ? "success" : "default"}>
                      <Chip.Label>{t(names[attempt.outcome])}</Chip.Label>
                    </Chip>
                    <time className="text-xs text-muted tabular-nums" dateTime={attempt.startedAt}>{formatTime(attempt.startedAt)}</time>
                  </div>
                  {attempt.error && <p className="text-sm leading-relaxed break-words text-muted">{attempt.error}</p>}
                </li>)}
              </ol>
            </ScrollShadow>
          </> : <Empty title={t("delivery.noAttempts")} />}
        </section>
      </Drawer.Body>
    </Drawer.Dialog></Drawer.Content>
  </Drawer.Backdrop>;
}
