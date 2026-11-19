"use client";

import { Button, Modal, Pagination, ScrollShadow } from "@heroui/react";
import { useState } from "react";
import { useTime } from "./use-time";
import { useResource } from "./use-resource";
import { Empty, Loading, Notice } from "./primitives";

export function AgendaDetails({ date, onClose }: { date: string | null; onClose: () => void }) {
  const { formatTime } = useTime();
  const [cursors, setCursors] = useState<Array<{ occurrenceAt: string; taskId: string }>>([]);
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  const cursor = cursors.at(-1);
  if (cursor) { query.set("after", cursor.occurrenceAt); query.set("task", cursor.taskId); }
  const { data, error, refresh } = useResource<{ items: Array<{ occurrenceAt: string; taskId: string; name: string }>; total: number; next: { occurrenceAt: string; taskId: string } | null }>(`/api/upcoming?${query}`, 0);
  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}><Modal.Container size="lg" placement="center" scroll="inside"><Modal.Dialog>
    <Modal.Header><Modal.Heading>{date ? `${date} 排期` : "未来七天完整排期"}</Modal.Heading></Modal.Header>
    <Modal.Body className="grid content-start gap-4">
      {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
      {data ? <>
        {data.items.length ? <ScrollShadow className="max-h-[45dvh] overflow-y-auto" size={16}>
          <ul className="space-y-3 text-sm">
            {data.items.map((item) => <li key={`${item.taskId}:${item.occurrenceAt}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <strong className="min-w-0 break-words">{item.name}</strong><time dateTime={item.occurrenceAt} className="text-xs text-muted tabular-nums">{formatTime(item.occurrenceAt)}</time>
            </li>)}
          </ul>
        </ScrollShadow> : <Empty title="暂无排期" description="所选日期没有剩余提醒。" />}
        <Pagination aria-label="排期分页" className="flex-row flex-wrap border-none p-0">
          <Pagination.Summary>共 {data.total} 次 · 第 {cursors.length + 1} 页</Pagination.Summary>
          <Pagination.Content>
            <Pagination.Item><Pagination.Previous isDisabled={!cursors.length} onPress={() => setCursors((current) => current.slice(0, -1))}>上一页</Pagination.Previous></Pagination.Item>
            <Pagination.Item><Pagination.Next isDisabled={!data.next} onPress={() => { const next = data.next; if (next) setCursors((current) => [...current, next]); }}>下一页</Pagination.Next></Pagination.Item>
          </Pagination.Content>
        </Pagination>
      </> : !error && <Loading>正在读取排期</Loading>}
    </Modal.Body>
    <Modal.Footer><Button variant="outline" onPress={onClose}>关闭</Button></Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>;
}
