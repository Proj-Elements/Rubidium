"use client";

import { Alert, AlertDialog, Button, Card, Chip, Disclosure, FieldError, Input, Label, Link, ListBox, NumberField, Select, Spinner, TextArea, TextField, Tooltip } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react";
import NextLink from "next/link";
import type { ComponentProps, ReactNode, Ref } from "react";
import type { Delivery, Task } from "@/lib/types";
import { Glyph, type IconName } from "./icons";

export function IconButton({ label, icon, className, ...props }: { label: string; icon: IconName } & Omit<ComponentProps<typeof Button>, "children" | "aria-label">) {
  return <Tooltip delay={350}>
    <Button isIconOnly type="button" variant="ghost" aria-label={label} className={`max-sm:min-h-11 max-sm:min-w-11 ${className ?? ""}`} {...props}><Glyph name={icon} /></Button>
    <Tooltip.Content>{label}</Tooltip.Content>
  </Tooltip>;
}

export function WorkspaceLink({ href, onNavigate, ...props }: Omit<ComponentProps<typeof Link>, "href" | "render"> & { href: string; onNavigate?: () => void }) {
  return <Link {...props} href={href} render={({ ref, ...domProps }) => <NextLink {...domProps} ref={ref as Ref<HTMLAnchorElement>} href={href} onNavigate={onNavigate} />} />;
}

export function PageHeading({ title, context }: { title: string; context?: ReactNode }) {
  return <header className="page-heading">
    <h1 className="text-2xl leading-tight font-semibold">{title}</h1>
    {context}
  </header>;
}

export function CardHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <Card.Header className="card-header flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2">
    <div className="min-w-0">
      <Card.Title render={(props) => <h2 {...props} />} className="text-base font-semibold">{title}</Card.Title>
    </div>
    {action}
  </Card.Header>;
}

export function Field({ label, required, disabled, type, name, ...props }: { label: string } & ComponentProps<typeof Input>) {
  return <TextField className="workspace-field" fullWidth type={type} name={name} isRequired={required} isDisabled={disabled}>
    <Label>{label}</Label>
    <Input variant="secondary" fullWidth {...props} />
  </TextField>;
}

export function AreaField({ label, error, ...props }: { label: string; error?: string } & ComponentProps<typeof TextArea>) {
  return <TextField className="workspace-field" fullWidth isInvalid={Boolean(error)}>
    <Label>{label}</Label>
    <TextArea variant="secondary" fullWidth {...props} />
    {error && <FieldError>{error}</FieldError>}
  </TextField>;
}

export function NumericField({ label, hideLabel, inputClassName, ...props }: { label: string; hideLabel?: boolean; inputClassName?: string } & ComponentProps<typeof NumberField>) {
  return <NumberField className="workspace-field" variant="secondary" aria-label={hideLabel ? label : undefined} {...props}>
    {!hideLabel && <Label>{label}</Label>}
    <NumberField.Group className="w-fit max-w-full">
      <NumberField.Input className={inputClassName ?? "w-28 tabular-nums"} />
    </NumberField.Group>
  </NumberField>;
}

export function Pick({ label, value, options, onChange, className, isDisabled, hideLabel }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; className?: string; isDisabled?: boolean; hideLabel?: boolean }) {
  return <Select aria-label={hideLabel ? label : undefined} className={`workspace-field ${className ?? ""}`} fullWidth variant="secondary" value={value} isDisabled={isDisabled} onChange={(key) => { if (key !== null) onChange(String(key)); }}>
    {!hideLabel && <Label>{label}</Label>}
    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
    <Select.Popover>
      <ListBox>{options.map((option) => <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
        <Label>{option.label}</Label><ListBox.ItemIndicator />
      </ListBox.Item>)}</ListBox>
    </Select.Popover>
  </Select>;
}

export function Details({ title, children }: { title: string; children: ReactNode }) {
  return <Disclosure>
    <Disclosure.Heading>
      <Disclosure.Trigger className="flex min-h-10 w-full items-center gap-2 rounded-lg text-start text-sm font-medium text-muted hover:text-foreground">
        {title}<Disclosure.Indicator />
      </Disclosure.Trigger>
    </Disclosure.Heading>
    <Disclosure.Content><Disclosure.Body className="grid gap-4 px-0 pt-2">{children}</Disclosure.Body></Disclosure.Content>
  </Disclosure>;
}

const taskLabels = { active: "进行中", paused: "已暂停", completed: "排期结束", archived: "已归档" };
export const deliveryLabels: Record<Delivery["status"], string> = {
  pending: "待投递", sending: "发送中", sent: "已接收", cancelled: "已取消", expired: "已过期",
};

export function TaskBadge({ task }: { task: Task }) {
  return <Chip variant="soft" className="w-fit shrink-0 whitespace-nowrap" color={task.status === "active" ? "success" : "default"}><Chip.Label>{taskLabels[task.status]}</Chip.Label></Chip>;
}

export function DeliveryBadge({ item }: { item: Delivery }) {
  const pending = item.status === "pending";
  const manual = pending && item.manualOnly;
  const retrying = pending && item.attempts > 0;
  return <Chip variant="soft" className="w-fit shrink-0 whitespace-nowrap" color={item.status === "sent" ? "success" : manual ? "danger" : retrying ? "warning" : "default"}>
    <Chip.Label>{manual ? "等待人工处理" : retrying ? "重试中" : deliveryLabels[item.status]}</Chip.Label>
  </Chip>;
}

export function Notice({ children, kind = "error", action }: { children: ReactNode; kind?: "error" | "success" | "info" | "warning"; action?: ReactNode }) {
  const status = kind === "error" ? "danger" : kind === "info" ? "accent" : kind;
  return <Alert className={`notice-${kind} items-start rounded-lg bg-surface-secondary shadow-none break-words`} status={status} role={kind === "error" ? "alert" : "status"}>
    <Alert.Indicator />
    <Alert.Content className="min-w-0 flex-1 gap-2 text-sm leading-relaxed [overflow-wrap:anywhere]">{children}{action && <div>{action}</div>}</Alert.Content>
  </Alert>;
}

export function Empty({ title, action, icon = "inbox" }: { title: string; action?: ReactNode; icon?: IconName }) {
  return <EmptyState className="px-4 py-8" size="sm">
    <EmptyState.Header>
      <EmptyState.Media variant="icon"><Glyph name={icon} className="text-accent" /></EmptyState.Media>
      <EmptyState.Title>{title}</EmptyState.Title>
    </EmptyState.Header>
    {action && <EmptyState.Content>{action}</EmptyState.Content>}
  </EmptyState>;
}

export function Loading({ children }: { children: ReactNode }) {
  return <div role="status" className="loading-state flex items-center justify-center gap-3 px-4 py-10 text-sm text-muted">
    <Spinner size="sm" aria-hidden="true" />{children}
  </div>;
}

export function Confirm({ title, children, confirmLabel, cancelLabel = "取消", onConfirm, onClose, busy = false }: { title: string; children: ReactNode; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return <AlertDialog.Backdrop isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} isKeyboardDismissDisabled={busy}>
    <AlertDialog.Container size="sm" placement="center"><AlertDialog.Dialog>
      <AlertDialog.Header><AlertDialog.Icon status="danger" /><AlertDialog.Heading className="[overflow-wrap:anywhere]">{title}</AlertDialog.Heading></AlertDialog.Header>
      <AlertDialog.Body className="text-sm leading-relaxed text-muted">{children}</AlertDialog.Body>
      <AlertDialog.Footer>
        <Button variant="ghost" autoFocus isDisabled={busy} onPress={onClose}>{cancelLabel}</Button>
        <Button variant="danger-soft" isPending={busy} onPress={onConfirm}>{confirmLabel}</Button>
      </AlertDialog.Footer>
    </AlertDialog.Dialog></AlertDialog.Container>
  </AlertDialog.Backdrop>;
}
