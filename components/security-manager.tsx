"use client";

import { Button, Card, Chip, FieldError, Fieldset, Form, Input, Label, Modal, TextField, Tooltip } from "@heroui/react";
import { ItemCard, ItemCardGroup } from "@heroui-pro/react";
import { useEffect, useState, type FormEvent } from "react";
import { SECURITY_SESSION_PAGE_SIZE } from "@/lib/contracts";
import { api, errorMessage } from "@/lib/ui";
import { Glyph } from "./icons";
import { Pagination } from "./pagination";
import { CardHeading, Confirm, Details, Empty, Field, IconButton, Loading, Notice, NumericField, Pick } from "./primitives";
import { useResource } from "./use-resource";
import { useTime } from "./use-time";
import { useUnsaved } from "./use-unsaved";
import { useWorkspace } from "./workspace-context";
import { MIN_PASSWORD_LENGTH, passwordValidationIssue } from "@/lib/password-policy";
import { useTranslations } from "./locale-provider";
import type { MessageKey } from "@/lib/i18n";

interface Security {
  sessions: Array<{ id: string; expiresAt: number }>;
  sessionPagination: { page: number; pageSize: number; total: number };
  tokens: Array<{ id: string; name: string; scope: string; expiresAt: number }>;
}

const defaultDays = 30;

export function SecurityManager({ active }: { active: boolean }) {
  const { t, locale } = useTranslations();
  const { formatTime } = useTime();
  const { notify } = useWorkspace();
  const [sessionPage, setSessionPage] = useState(1);
  const { data, error, refresh } = useResource<Security>(`/api/security?page=${sessionPage}`, 0, active);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [days, setDays] = useState(defaultDays);
  const [expiryTooltipOpen, setExpiryTooltipOpen] = useState(false);
  const [token, setToken] = useState("");
  const [mcpAddressOpen, setMcpAddressOpen] = useState(false);
  const [revocation, setRevocation] = useState<{ id: string; kind: "session" | "token"; name: string } | null>(null);
  const [busy, setBusy] = useState<"password" | "token" | "revoke" | null>(null);
  const passwordIssue = next ? passwordValidationIssue(next) : null;
  const passwordReason = passwordIssue ? t(passwordIssue.key, passwordIssue.values) : null;
  const passwordMismatch = next.length > 0 && next !== confirmNext;
  const scopes = [{ value: "read", label: t("security.readOnly") }, { value: "write", label: t("security.readWrite") }];
  useUnsaved(Boolean(current || next || confirmNext || name || scope !== "read" || days !== defaultDays));

  async function mutate(action: NonNullable<typeof busy>, fields: object, message: string) {
    if (busy) return false;
    setBusy(action);
    try {
      const response = await api<{ token?: string }>("/api/security", { method: "POST", body: JSON.stringify({ action, ...fields }) });
      setToken(response.token ?? "");
      if (action !== "token") notify(message);
      await refresh();
      return true;
    } catch (error) { notify(errorMessage(error, locale), "error"); return false; }
    finally { setBusy(null); }
  }

  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !next || !confirmNext || passwordIssue || next !== confirmNext) return;
    if (await mutate("password", { current, next }, t("security.passwordChanged"))) { setCurrent(""); setNext(""); setConfirmNext(""); }
  }

  async function credential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate("token", { name, scope, days }, "")) { setName(""); setScope("read"); setDays(defaultDays); }
  }

  async function revoke() {
    if (!revocation) return;
    const { kind, id } = revocation;
    const previousPage = data?.sessionPagination.page;
    const lastSessionOnPage = kind === "session" && data?.sessions.length === 1;
    if (await mutate("revoke", { kind, id }, kind === "token" ? t("security.credentialRevoked") : t("security.sessionRevoked"))) {
      if (lastSessionOnPage && previousPage && previousPage > 1) setSessionPage(previousPage - 1);
      setRevocation(null);
    }
  }

  return <div className="grid items-start gap-5 @min-[52rem]/settings:grid-cols-2">
    {error && <div className="@min-[52rem]/settings:col-span-2"><Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("common.retry")}</Button>}>{error}</Notice></div>}
    <Card className="min-w-0 gap-5 p-5 sm:p-6 @min-[52rem]/settings:col-span-2">
      <CardHeading title={t("security.password")} />
      <Form onSubmit={password}>
        <Fieldset className="min-w-0 gap-4" disabled={busy !== null}>
          <Fieldset.Group className="security-password-fields @min-[52rem]/settings:grid-cols-2">
            <Field label={t("security.currentPassword")} type="password" value={current} onChange={(event) => setCurrent(event.target.value)} maxLength={300} autoComplete="current-password" required />
            <TextField className="workspace-field" fullWidth isRequired isDisabled={busy !== null} isInvalid={Boolean(passwordReason)}>
              <Label>{t("security.newPassword")}</Label>
              <Input variant="secondary" fullWidth className="h-11" type="password" value={next} onChange={(event) => setNext(event.target.value)} minLength={MIN_PASSWORD_LENGTH} maxLength={300} autoComplete="new-password" />
              {passwordReason && <FieldError>{passwordReason}</FieldError>}
            </TextField>
            <TextField className="workspace-field" fullWidth name="confirmNewPassword" type="password" isRequired isDisabled={busy !== null} isInvalid={passwordMismatch}>
              <Label>{t("security.confirmPassword")}</Label>
              <Input variant="secondary" fullWidth className="h-11" autoComplete="new-password" value={confirmNext} onChange={(event) => setConfirmNext(event.target.value)} maxLength={300} />
              {passwordMismatch && <FieldError>{confirmNext ? t("security.passwordMismatch") : t("security.confirmHint")}</FieldError>}
            </TextField>
          </Fieldset.Group>
          <Fieldset.Actions><Button type="submit" isPending={busy === "password"} isDisabled={busy !== null || !current || !next || !confirmNext || Boolean(passwordIssue) || passwordMismatch}>{t("security.changePassword")}</Button></Fieldset.Actions>
        </Fieldset>
      </Form>
    </Card>

    <Card className="min-w-0 gap-5 p-5 sm:p-6">
      <CardHeading title={t("security.apiCredentials")} />
      {data ? (data.tokens.length ? <ItemCardGroup variant="transparent" role="list" aria-label={t("security.apiCredentials")}>
        {data.tokens.map((item) => <ItemCard key={item.id} role="listitem" variant="transparent" className="flex-wrap px-0">
          <ItemCard.Content className="min-w-36">
            <div className="flex flex-wrap items-center gap-2"><ItemCard.Title>{item.name}</ItemCard.Title><Chip variant="soft"><Chip.Label>{item.scope === "read" ? t("security.readOnly") : t("security.readWrite")}</Chip.Label></Chip></div>
            <ItemCard.Description className="tabular-nums">{item.expiresAt === 0 ? t("security.neverExpires") : t("security.expiresAt", { time: formatTime(new Date(item.expiresAt).toISOString()) })}</ItemCard.Description>
          </ItemCard.Content>
          <ItemCard.Action><Button variant="danger-soft" isDisabled={busy !== null} onPress={() => setRevocation({ id: item.id, kind: "token", name: item.name })}>{t("security.revokeCredential")}</Button></ItemCard.Action>
        </ItemCard>)}
      </ItemCardGroup> : <p className="text-sm text-muted">{t("security.noCredentials")}</p>) : !error && <Loading>{t("security.loadingCredentials")}</Loading>}
      <Details title={t("security.createCredential")}>
        <Form onSubmit={credential}>
          <Fieldset className="min-w-0 gap-3" disabled={busy !== null}>
            <Fieldset.Group>
              <Field label={t("security.credentialName")} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
              <div className="grid grid-cols-2 items-start gap-4">
                <Pick label={t("security.permission")} value={scope} onChange={setScope} className="credential-scope" options={scopes} isDisabled={busy !== null} />
                <div className="grid content-start gap-1">
                  <div className="flex min-h-11 items-center gap-1">
                    <span className="label font-medium text-foreground">{t("security.validDays")}</span>
                    <Tooltip delay={350} isOpen={expiryTooltipOpen} onOpenChange={setExpiryTooltipOpen}>
                      <Button isIconOnly variant="ghost" aria-label={t("security.expiryHelpLabel")} className="size-11 shrink-0"
                        onPointerEnter={() => setExpiryTooltipOpen(true)} onPointerLeave={() => setExpiryTooltipOpen(false)}>
                        <Glyph name="info" />
                      </Button>
                      <Tooltip.Content>{t("security.expiryHelp")}</Tooltip.Content>
                    </Tooltip>
                  </div>
                  <NumericField label={t("security.validDays")} hideLabel value={days} onChange={setDays} minValue={0} maxValue={365} isRequired isDisabled={busy !== null} />
                </div>
              </div>
            </Fieldset.Group>
            <Fieldset.Actions><Button type="submit" variant="outline" isPending={busy === "token"} isDisabled={busy !== null && busy !== "token"}>{t("security.create")}</Button></Fieldset.Actions>
          </Fieldset>
        </Form>
      </Details>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a className="workspace-link" href="https://github.com/Proj-Elements/Rubidium/blob/main/docs/api-mcp.md#http-api" target="_blank" rel="noreferrer">{t("security.apiDocs")}<Glyph name="link" size={14} /></a>
        <a className="workspace-link" href="https://github.com/Proj-Elements/Rubidium/blob/main/docs/api-mcp.md#mcp-streamable-http" target="_blank" rel="noreferrer">{t("security.mcpDocs")}<Glyph name="link" size={14} /></a>
        <Button variant="outline" className="min-h-11" onPress={() => setMcpAddressOpen((open) => !open)} aria-expanded={mcpAddressOpen}>{t("security.openMcpAddress")}</Button>
      </div>
      {mcpAddressOpen && <McpAddress />}
      {token && <Notice kind="info" action={<Button variant="ghost" onPress={() => setToken("")}>{t("security.dismissCredential")}</Button>}>
        <p>{t("security.tokenShownOnce")}</p>
        <div className="workspace-field"><Input aria-label={t("security.newCredentialLabel")} className="font-mono" fullWidth value={token} readOnly onFocus={(event) => event.currentTarget.select()} /></div>
      </Notice>}
    </Card>

    <Card className="min-w-0 gap-5 p-5 sm:p-6">
      <CardHeading title={t("security.sessions")} />
      {data ? (data.sessions.length ? <>
        <ItemCardGroup variant="transparent" role="list" aria-label={t("security.sessionList")}>
          {data.sessions.map((item) => <ItemCard key={item.id} role="listitem" variant="transparent" className="flex-wrap px-0">
            <ItemCard.Content className="min-w-36">
              <ItemCard.Title>{t("security.sessionId", { id: item.id.slice(0, 8) })}</ItemCard.Title>
              <ItemCard.Description className="tabular-nums">{t("security.expiresAt", { time: formatTime(new Date(item.expiresAt).toISOString()) })}</ItemCard.Description>
            </ItemCard.Content>
            <ItemCard.Action><Button variant="danger-soft" isDisabled={busy !== null} onPress={() => setRevocation({ id: item.id, kind: "session", name: t("security.sessionId", { id: item.id.slice(0, 8) }) })}>{t("security.revokeSession")}</Button></ItemCard.Action>
          </ItemCard>)}
        </ItemCardGroup>
        <Pagination page={data.sessionPagination.page} total={data.sessionPagination.total} pageSize={SECURITY_SESSION_PAGE_SIZE} onChange={setSessionPage} />
      </> : <p className="text-sm text-muted">{t("security.noSessions")}</p>) : !error && <Loading>{t("security.loadingSessions")}</Loading>}
    </Card>

    {revocation && <Confirm title={t("security.revokeTitle", { name: revocation.name })} confirmLabel={t("common.confirm")} onClose={() => setRevocation(null)} onConfirm={() => void revoke()} busy={busy === "revoke"}>
      <p>{revocation.kind === "token" ? t("security.revokeTokenDescription") : t("security.revokeSessionDescription")}</p>
    </Confirm>}
  </div>;
}

function McpAddress() {
  const { t } = useTranslations();
  const { notify } = useWorkspace();
  const [address, setAddress] = useState("");
  useEffect(() => setAddress(`${window.location.origin}/api/mcp`), []);
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
    <Input aria-label={t("security.mcpAddressLabel")} className="min-w-0 font-mono" variant="secondary" value={address} readOnly />
    <IconButton icon="copy" label={t("security.copyMcpAddress")} isDisabled={!address} onPress={() => {
      void navigator.clipboard.writeText(address).then(() => notify(t("security.mcpCopied")))
        .catch(() => notify(t("security.clipboardDenied"), "error"));
    }} />
  </div>;
}

const auditActionKeys: Record<string, MessageKey> = {
  "session.create": "audit.sessionCreate", "session.logout": "audit.sessionLogout",
  "settings.update": "audit.settingsUpdate", "history.prune": "audit.historyPrune",
  "task.create": "audit.taskCreate", "task.update": "audit.taskUpdate", "task.restore": "audit.taskRestore",
  "task.active": "audit.taskActive", "task.paused": "audit.taskPaused", "task.archive": "audit.taskArchive", "task.delete": "audit.taskDelete",
  "delivery.retry": "audit.deliveryRetry", "delivery.cancel": "audit.deliveryCancel", "delivery.edit": "audit.deliveryEdit",
  "device.create": "audit.deviceCreate", "device.update": "audit.deviceUpdate", "device.delete": "audit.deviceDelete",
  "channel.create": "audit.channelCreate", "channel.update": "audit.channelUpdate", "channel.delete": "audit.channelDelete",
  "security.password.change": "audit.passwordChange", "security.token.create": "audit.tokenCreate",
  "security.token.revoke": "audit.tokenRevoke", "security.session.revoke": "audit.sessionRevoke", "data.import": "audit.dataImport",
};
const auditPageSize = 8;
type AuditEvent = { id: string; action: string; target: string; createdAt: string };

export function AuditLog({ active }: { active: boolean }) {
  const { t } = useTranslations();
  const { formatTime } = useTime();
  const { notify } = useWorkspace();
  const { data, error, refresh } = useResource<{ events: AuditEvent[] }>("/api/audit", 15_000, active);
  const [details, setDetails] = useState<AuditEvent | null>(null);
  const [page, setPage] = useState(1);
  const total = data?.events.length ?? 0;
  const displayedPage = Math.min(page, Math.max(1, Math.ceil(total / auditPageSize)));
  const events = data?.events.slice((displayedPage - 1) * auditPageSize, displayedPage * auditPageSize) ?? [];

  return <Card className="min-w-0 gap-4 p-5 sm:p-6">
    <CardHeading title={t("settings.audit")} />
    {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>{t("common.retry")}</Button>}>{error}</Notice>}
    {events.length ? <>
      <ItemCardGroup variant="transparent" role="list" aria-label={t("settings.auditList")}>
        {events.map((item) => <ItemCard key={item.id} role="listitem" variant="transparent" className="min-w-0 px-0">
          <ItemCard.Content>
            <ItemCard.Title>{auditActionKeys[item.action] ? t(auditActionKeys[item.action]) : item.action}</ItemCard.Title>
            <ItemCard.Description><time dateTime={item.createdAt} className="tabular-nums">{formatTime(item.createdAt)}</time></ItemCard.Description>
            <code className="mt-1 max-w-full truncate text-xs text-muted">{item.target || t("audit.unknownTarget")}</code>
          </ItemCard.Content>
          <ItemCard.Action><IconButton icon="inbox" label={t("security.auditViewNamed", { name: auditActionKeys[item.action] ? t(auditActionKeys[item.action]) : item.action })} onPress={() => setDetails(item)} /></ItemCard.Action>
        </ItemCard>)}
      </ItemCardGroup>
      <Pagination page={displayedPage} total={total} pageSize={auditPageSize} onChange={setPage} />
    </> : data ? <Empty title={t("settings.auditEmpty")} /> : !error && <Loading>{t("settings.auditLoading")}</Loading>}
    {details && <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) setDetails(null); }}>
      <Modal.Container size="sm" placement="center"><Modal.Dialog>
        <Modal.Header><Modal.Heading>{t("settings.auditDetails")}</Modal.Heading></Modal.Header>
        <Modal.Body className="grid gap-4">
          <p className="font-medium">{auditActionKeys[details.action] ? t(auditActionKeys[details.action]) : details.action}</p>
          <time dateTime={details.createdAt} className="text-sm text-muted tabular-nums">{formatTime(details.createdAt)}</time>
          <div className="grid gap-2"><p className="text-xs text-muted">{t("settings.auditTarget")}</p><code className="select-all text-sm [overflow-wrap:anywhere]">{details.target || t("audit.unknownTarget")}</code></div>
        </Modal.Body>
        <Modal.Footer className="flex-wrap">
          <Button variant="ghost" onPress={() => setDetails(null)}>{t("common.close")}</Button>
          {details.target && <Button variant="outline" onPress={() => { void navigator.clipboard.writeText(details.target).then(() => notify(t("settings.targetCopied")), () => notify(t("settings.targetCopyFailed"), "error")); }}>{t("settings.copyTarget")}</Button>}
        </Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>}
  </Card>;
}
