"use client";

import { Button, Modal } from "@heroui/react";
import type { ReactNode } from "react";
import { useTranslations } from "@/components/locale-provider";
import { Glyph } from "@/components/icons";
import { TaskBadge } from "@/components/primitives";
import { useResource } from "@/components/use-resource";
import { localeTags, presetMessageKeys } from "@/lib/i18n";
import type { Channel, Task } from "@/lib/types";

export function ReminderDetails({ task, onClose, onEdit }: { task: Task; onClose: () => void; onEdit: () => void }) {
  const { t, locale } = useTranslations();
  const { data: channelData } = useResource<{ channels: Channel[] }>("/api/channels", 0);
  const channel = channelData?.channels.find((item) => item.id === task.deviceId);
  const formatTimestamp = (value: string | null) => {
    if (!value) return t("reminder.detail.noValue");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat(localeTags[locale], { timeZone: task.timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
  };
  const formatDate = (value: string | null) => {
    if (!value) return t("reminder.detail.noEndDate");
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat(localeTags[locale], { timeZone: "UTC", dateStyle: "long" }).format(date);
  };
  const noValue = t("reminder.detail.noValue");
  return <Modal.Backdrop isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }}>
    <Modal.Container size="lg" placement="center" scroll="inside">
      <Modal.Dialog className="reminder-detail-dialog flex max-h-[min(90dvh,52rem)] min-w-0 flex-col p-0">
        <Modal.Header className="shrink-0 flex-row items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0 space-y-2">
            <Modal.Heading>{t("overview.reminderDetails")}</Modal.Heading>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-lg font-semibold">{task.name}</h2>
              <TaskBadge task={task} />
            </div>
          </div>
          <Button isIconOnly variant="ghost" aria-label={t("reminder.detail.close")} className="size-11 shrink-0" onPress={onClose}><Glyph name="close" /></Button>
        </Modal.Header>
        <Modal.Body className="grid min-h-0 content-start gap-5 px-5 py-4 sm:px-6">
          <section className="grid min-w-0 gap-2" aria-labelledby="reminder-detail-description">
            <h3 id="reminder-detail-description" className="font-semibold">{t("reminder.detail.description")}</h3>
            <p className="min-w-0 whitespace-pre-wrap break-words rounded-lg bg-surface-secondary p-3 text-sm leading-relaxed">{task.description || t("reminder.detail.defaultContent")}</p>
          </section>

          <section className="grid min-w-0 gap-2" aria-labelledby="reminder-detail-schedule">
            <h3 id="reminder-detail-schedule" className="font-semibold">{t("reminder.detail.schedule")}</h3>
            <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
              <Detail label={t("reminder.detail.status")}><TaskBadge task={task} /></Detail>
              <Detail label={t("reminder.detail.startsAt")}>{formatTimestamp(task.startsAt)}</Detail>
              <Detail label={t("reminder.detail.nextRunAt")}>{formatTimestamp(task.nextRunAt)}</Detail>
              <Detail label={t("reminder.detail.lastRunAt")}>{formatTimestamp(task.lastRunAt)}</Detail>
              <Detail label={t("reminder.detail.recurrence")}>{t(presetMessageKeys[task.preset])}</Detail>
              <Detail label={t("reminder.detail.cron")}><code className="break-all">{task.cron}</code></Detail>
              <Detail label={t("reminder.detail.timeZone")}>{task.timeZone}</Detail>
              <Detail label={t("reminder.detail.repeatCount")}>{task.repeatCount === null ? t("reminder.detail.unlimited") : task.repeatCount}</Detail>
              <Detail label={t("reminder.detail.endDate")}>{formatDate(task.endDate)}</Detail>
              <Detail label={t("reminder.detail.maxLateness")}>{task.maxLatenessMinutes === null ? t("reminder.detail.unlimited") : `${task.maxLatenessMinutes} min`}</Detail>
              <Detail label={t("reminder.detail.pausedAt")}>{formatTimestamp(task.pausedAt)}</Detail>
              <Detail label={t("reminder.detail.skipDates")}><DateList items={task.skipDates} empty={noValue} /></Detail>
              <Detail label={t("reminder.detail.includeDates")}><DateList items={task.includeDates} empty={noValue} /></Detail>
            </dl>
          </section>

          <section className="grid min-w-0 gap-2" aria-labelledby="reminder-detail-notifications">
            <h3 id="reminder-detail-notifications" className="font-semibold">{t("reminder.detail.notifications")}</h3>
            <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
              <Detail label={t("reminder.detail.channel")}>
                {channel?.name ?? (task.deviceId === "default" ? t("reminder.detail.defaultChannel") : task.deviceId)}
              </Detail>
              <Detail label={t("reminder.detail.channelType")}>{channel?.type ?? noValue}</Detail>
              {channel && <Detail label={t("reminder.detail.endpoint")}><span className="break-all">{channel.endpoint}</span></Detail>}
              {channel?.topic && <Detail label={t("reminder.detail.topic")}>{channel.topic}</Detail>}
              <Detail label={t("reminder.detail.sound")}>{task.notification.sound || noValue}</Detail>
              <Detail label={t("reminder.detail.group")}>{task.notification.group || noValue}</Detail>
              <Detail label={t("reminder.detail.icon")} className="sm:col-span-2">
                {task.notification.icon ? <a className="break-all text-link underline" href={task.notification.icon} target="_blank" rel="noreferrer">{task.notification.icon}</a> : noValue}
              </Detail>
            </dl>
          </section>

          <section className="grid min-w-0 gap-2" aria-labelledby="reminder-detail-delivery">
            <h3 id="reminder-detail-delivery" className="font-semibold">{t("reminder.detail.delivery")}</h3>
            <dl className="grid min-w-0 gap-2 sm:grid-cols-3">
              <Detail label={t("reminder.detail.sentCount")}>{task.sentCount}</Detail>
              <Detail label={t("reminder.detail.queuedCount")}>{task.queuedCount}</Detail>
              <Detail label={t("reminder.detail.pendingCount")}>{task.pendingCount}</Detail>
              {task.lastError && <Detail label={t("reminder.detail.lastError")} className="sm:col-span-3"><span className="break-words text-warning-soft-foreground">{task.lastError}</span></Detail>}
            </dl>
          </section>

          <section className="grid min-w-0 gap-2" aria-labelledby="reminder-detail-metadata">
            <h3 id="reminder-detail-metadata" className="font-semibold">{t("reminder.detail.metadata")}</h3>
            <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
              <Detail label={t("reminder.detail.id")}><code className="break-all">{task.id}</code></Detail>
              <Detail label={t("reminder.detail.revision")}>{task.revision}</Detail>
              <Detail label={t("reminder.detail.createdAt")}>{formatTimestamp(task.createdAt)}</Detail>
              <Detail label={t("reminder.detail.updatedAt")}>{formatTimestamp(task.updatedAt)}</Detail>
            </dl>
          </section>
        </Modal.Body>
        <Modal.Footer className="shrink-0 flex-wrap justify-end gap-2 px-5 pb-5 sm:px-6">
          <Button variant="outline" className="min-h-11" onPress={onClose}>{t("common.close")}</Button>
          <Button className="min-h-11" onPress={onEdit}>{t("reminder.detail.edit")}</Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}

function Detail({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-lg bg-surface-secondary p-3 ${className}`}>
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-1 min-w-0 break-words text-sm leading-relaxed">{children}</dd>
  </div>;
}

function DateList({ items, empty }: { items: string[]; empty: string }) {
  return <div className="max-h-32 overflow-y-auto break-words">{items.length ? items.join(" · ") : empty}</div>;
}
