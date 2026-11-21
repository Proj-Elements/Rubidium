"use client";

import { Button, Card, Chip, Fieldset, Form, Input, Modal } from "@heroui/react";
import { ItemCard, ItemCardGroup } from "@heroui-pro/react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/ui";
import { Pagination } from "./pagination";
import { CardHeading, Confirm, Details, Empty, Field, IconButton, Loading, Notice, NumericField, Pick } from "./primitives";
import { useResource } from "./use-resource";
import { useTime } from "./use-time";
import { useUnsaved } from "./use-unsaved";
import { useWorkspace } from "./workspace-context";

interface Security {
  sessions: Array<{ id: string; expiresAt: number }>;
  tokens: Array<{ id: string; name: string; scope: string; expiresAt: number }>;
}

const scopes = [{ value: "read", label: "只读" }, { value: "write", label: "读写" }];
const defaultDays = 30;

export function SecurityManager() {
  const { formatTime } = useTime();
  const { notify } = useWorkspace();
  const { data, error, refresh } = useResource<Security>("/api/security", 0);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [days, setDays] = useState(defaultDays);
  const [token, setToken] = useState("");
  const [revocation, setRevocation] = useState<{ id: string; kind: "session" | "token"; name: string } | null>(null);
  const [busy, setBusy] = useState<"password" | "token" | "revoke" | null>(null);
  useUnsaved(Boolean(current || next || name || scope !== "read" || days !== defaultDays));

  async function mutate(action: NonNullable<typeof busy>, fields: object, message: string) {
    if (busy) return false;
    setBusy(action);
    try {
      const response = await api<{ token?: string }>("/api/security", { method: "POST", body: JSON.stringify({ action, ...fields }) });
      setToken(response.token ?? "");
      if (action !== "token") notify(message);
      await refresh();
      return true;
    } catch (error) { notify(errorMessage(error), "error"); return false; }
    finally { setBusy(null); }
  }

  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate("password", { current, next }, "访问密码已更新。")) { setCurrent(""); setNext(""); }
  }

  async function credential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate("token", { name, scope, days }, "")) { setName(""); setScope("read"); setDays(defaultDays); }
  }

  async function revoke() {
    if (!revocation) return;
    const { kind, id } = revocation;
    if (await mutate("revoke", { kind, id }, kind === "token" ? "API 凭据已撤销。" : "会话已撤销。")) setRevocation(null);
  }

  return <div className="grid items-start gap-5 @min-[52rem]/settings:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
    <Card className="min-w-0 gap-5 p-5 sm:p-6">
      <CardHeading title="访问密码" description="修改密码会撤销其他会话和全部 API 凭据。服务端环境密码变更后，以环境配置为准。" />
      <Form onSubmit={password}>
        <Fieldset className="min-w-0 gap-4" disabled={busy !== null}>
          <Fieldset.Group>
            <Field label="当前访问密码" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} maxLength={300} autoComplete="current-password" required />
            <Field label="新访问密码" type="password" value={next} onChange={(event) => setNext(event.target.value)} minLength={16} maxLength={300} autoComplete="new-password" required hint="至少 16 个字符。" />
          </Fieldset.Group>
          <Fieldset.Actions><Button type="submit" isPending={busy === "password"} isDisabled={busy !== null && busy !== "password"}>修改访问密码</Button></Fieldset.Actions>
        </Fieldset>
      </Form>
    </Card>

    <Card className="min-w-0 gap-5 p-5 sm:p-6">
      <CardHeading title="会话与凭据" description="管理已登录的会话，以及客户端访问 API 使用的凭据。" />
      {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
      <section className="grid min-w-0 gap-2">
        <h3 className="text-sm font-semibold">API 凭据</h3>
        {data && (data.tokens.length ? <ItemCardGroup variant="transparent" role="list" aria-label="API 凭据">
          {data.tokens.map((item) => <ItemCard key={item.id} role="listitem" variant="transparent" className="flex-wrap px-0">
            <ItemCard.Content className="min-w-36">
              <div className="flex flex-wrap items-center gap-2"><ItemCard.Title>{item.name}</ItemCard.Title><Chip variant="soft"><Chip.Label>{item.scope === "read" ? "只读" : "读写"}</Chip.Label></Chip></div>
              <ItemCard.Description className="tabular-nums">到期 {formatTime(new Date(item.expiresAt).toISOString())}</ItemCard.Description>
            </ItemCard.Content>
            <ItemCard.Action><Button variant="danger-soft" isDisabled={busy !== null} onPress={() => setRevocation({ id: item.id, kind: "token", name: item.name })}>撤销凭据</Button></ItemCard.Action>
          </ItemCard>)}
        </ItemCardGroup> : <p className="text-sm text-muted">尚未创建 API 凭据。</p>)}
        <Details title="创建 API 凭据">
          <Form onSubmit={credential}>
            <Fieldset className="min-w-0 gap-3" disabled={busy !== null}>
              <Fieldset.Group>
                <Field label="凭据名称" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
                <div className="grid grid-cols-2 items-start gap-4">
                  <Pick label="凭据权限" value={scope} onChange={setScope} options={scopes} isDisabled={busy !== null} />
                  <NumericField label="有效天数" value={days} onChange={setDays} minValue={1} maxValue={365} isRequired isDisabled={busy !== null} />
                </div>
              </Fieldset.Group>
              <Fieldset.Actions><Button type="submit" variant="outline" isPending={busy === "token"} isDisabled={busy !== null && busy !== "token"}>创建凭据</Button></Fieldset.Actions>
            </Fieldset>
          </Form>
        </Details>
        {token && <Notice kind="info" action={<Button variant="ghost" onPress={() => setToken("")}>关闭提示</Button>}>
          <p>凭据只显示这一次。请复制保存，在请求头中使用 <code>Authorization: Bearer</code>。</p>
          <div className="workspace-field"><Input aria-label="新 API 凭据" className="font-mono" fullWidth value={token} readOnly onFocus={(event) => event.currentTarget.select()} /></div>
        </Notice>}
      </section>
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">有效会话</h3>
        {data ? (data.sessions.length ? <ItemCardGroup variant="transparent" role="list" aria-label="有效会话">
          {data.sessions.map((item) => <ItemCard key={item.id} role="listitem" variant="transparent" className="flex-wrap px-0">
            <ItemCard.Content className="min-w-36">
              <ItemCard.Title>会话 <code className="tabular-nums">{item.id.slice(0, 8)}</code></ItemCard.Title>
              <ItemCard.Description className="tabular-nums">到期 {formatTime(new Date(item.expiresAt).toISOString())}</ItemCard.Description>
            </ItemCard.Content>
            <ItemCard.Action><Button variant="danger-soft" isDisabled={busy !== null} onPress={() => setRevocation({ id: item.id, kind: "session", name: `会话 ${item.id.slice(0, 8)}` })}>撤销会话</Button></ItemCard.Action>
          </ItemCard>)}
        </ItemCardGroup> : <p className="text-sm text-muted">暂无有效会话。</p>) : !error && <Loading>正在读取访问记录</Loading>}
      </section>
    </Card>

    {revocation && <Confirm title={`撤销「${revocation.name}」？`} confirmLabel="确认撤销" onClose={() => setRevocation(null)} onConfirm={() => void revoke()} busy={busy === "revoke"}>
      <p>{revocation.kind === "token" ? "使用此 API 凭据的客户端将失去访问权限。" : "此会话将立即退出，需要重新登录。"}</p>
    </Confirm>}
  </div>;
}

const auditActions: Record<string, string> = {
  "session.create": "登录工作空间", "session.logout": "退出工作空间",
  "settings.update": "保存推送设置", "history.prune": "清理旧记录",
  "task.create": "新建提醒", "task.update": "编辑提醒", "task.restore": "恢复归档提醒",
  "task.active": "启用提醒", "task.paused": "暂停提醒", "task.archive": "归档提醒", "task.delete": "删除提醒",
  "delivery.retry": "重试投递", "delivery.cancel": "取消投递", "delivery.edit": "编辑投递",
  "device.create": "添加设备", "device.update": "编辑设备", "device.delete": "删除设备",
  "security.password.change": "修改访问密码", "security.token.create": "创建 API 凭据",
  "security.token.revoke": "撤销 API 凭据", "security.session.revoke": "撤销会话",
};
const auditPageSize = 8;
type AuditEvent = { id: string; action: string; target: string; createdAt: string };

export function AuditLog() {
  const { formatTime } = useTime();
  const { notify } = useWorkspace();
  const { data, error, refresh } = useResource<{ events: AuditEvent[] }>("/api/audit", 15_000);
  const [details, setDetails] = useState<AuditEvent | null>(null);
  const [page, setPage] = useState(1);
  const total = data?.events.length ?? 0;
  const displayedPage = Math.min(page, Math.max(1, Math.ceil(total / auditPageSize)));
  const events = data?.events.slice((displayedPage - 1) * auditPageSize, displayedPage * auditPageSize) ?? [];

  return <Card className="min-w-0 gap-4 p-5 sm:p-6">
    <CardHeading title="操作审计" description="显示最近 100 次操作。审计不记录密码或消息正文。" />
    {error && <Notice action={<Button variant="ghost" onPress={() => void refresh()}>重试</Button>}>{error}</Notice>}
    {events.length ? <>
      <ItemCardGroup variant="transparent" role="list" aria-label="操作审计">
        {events.map((item) => <ItemCard key={item.id} role="listitem" variant="transparent" className="min-w-0 px-0">
          <ItemCard.Content>
            <ItemCard.Title>{auditActions[item.action] ?? item.action}</ItemCard.Title>
            <ItemCard.Description><time dateTime={item.createdAt} className="tabular-nums">{formatTime(item.createdAt)}</time></ItemCard.Description>
            <code className="mt-1 max-w-full truncate text-xs text-muted">{item.target || "工作空间"}</code>
          </ItemCard.Content>
          <ItemCard.Action><IconButton icon="inbox" label={`查看审计详情 ${auditActions[item.action] ?? item.action}`} onPress={() => setDetails(item)} /></ItemCard.Action>
        </ItemCard>)}
      </ItemCardGroup>
      <Pagination page={displayedPage} total={total} pageSize={auditPageSize} onChange={setPage} />
    </> : data ? <Empty title="暂无操作记录" description="工作空间的变更会记录在这里。" /> : !error && <Loading>正在读取操作审计</Loading>}
    {details && <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) setDetails(null); }}>
      <Modal.Container size="sm" placement="center"><Modal.Dialog>
        <Modal.Header><Modal.Heading>操作详情</Modal.Heading></Modal.Header>
        <Modal.Body className="grid gap-4">
          <p className="font-medium">{auditActions[details.action] ?? details.action}</p>
          <time dateTime={details.createdAt} className="text-sm text-muted tabular-nums">{formatTime(details.createdAt)}</time>
          <div className="grid gap-2"><p className="text-xs text-muted">完整目标标识</p><code className="select-all text-sm [overflow-wrap:anywhere]">{details.target || "工作空间"}</code></div>
        </Modal.Body>
        <Modal.Footer className="flex-wrap">
          <Button variant="ghost" onPress={() => setDetails(null)}>关闭</Button>
          {details.target && <Button variant="outline" onPress={() => { void navigator.clipboard.writeText(details.target).then(() => notify("目标标识已复制。"), () => notify("无法自动复制，请选中完整标识复制。", "error")); }}>复制标识</Button>}
        </Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>}
  </Card>;
}
