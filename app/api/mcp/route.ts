import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import packageMetadata from "../../../package.json";
import { requestIsAuthorized } from "@/lib/auth";
import { getTask } from "@/lib/db";
import { apiRoute, jsonError, jsonErrorFrom, MAX_REQUEST_BYTES, requireSameOrigin } from "@/lib/http";
import { taskFields } from "@/lib/contracts";
import { DomainError } from "@/lib/errors";
import { logError } from "@/lib/logging";
import { GET as taskListApi, POST as createTaskApi } from "../tasks/route";
import { PATCH as updateTaskStatusApi, PUT as updateTaskApi, DELETE as archiveTaskApi } from "../tasks/[id]/route";
import { GET as listDeliveriesApi } from "../deliveries/route";
import { GET as deliveryAttemptsApi } from "../deliveries/[id]/attempts/route";
import { POST as retryDeliveryApi } from "../deliveries/[id]/retry/route";
import { POST as cancelDeliveryApi } from "../deliveries/[id]/cancel/route";
import { GET as overviewApi } from "../overview/route";
import { GET as upcomingApi } from "../upcoming/route";
import { DELETE as deleteChannelApi, GET as listChannelsApi, POST as createChannelApi, PUT as updateChannelApi } from "../channels/route";
import { POST as testChannelApi } from "../channels/[id]/test/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiRoute = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const taskStatusSchema = z.enum(["active", "paused", "completed", "archived"]);
const deliveryStatusSchema = z.enum(["pending", "sending", "sent", "retrying", "cancelled", "expired"]);
const listSchema = z.object({
  page: z.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.number().int().min(1).max(50).default(12),
  status: taskStatusSchema.optional(),
  q: z.string().max(200).optional(),
});
const deliveryListSchema = listSchema.extend({ status: deliveryStatusSchema.optional() });
const taskCreateSchema = taskFields.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional() });
const taskUpdateSchema = taskFields.extend({ revision: z.number().int().positive() });
const taskStatusUpdateSchema = z.object({ id: z.string().min(1).max(100), status: z.enum(["active", "paused"]), revision: z.number().int().positive() });
const archiveSchema = z.object({ id: z.string().min(1).max(100), revision: z.number().int().positive() });
const idSchema = z.object({ id: z.string().min(1).max(100) });
const channelFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(["bark", "ntfy"]),
  endpoint: z.string().trim().min(1).max(300),
  topic: z.string().max(64).optional(),
  credential: z.string().max(512).optional(),
});
const channelCreateSchema = channelFieldsSchema;
const channelUpdateSchema = channelFieldsSchema.extend({
  id: z.string().min(1).max(100),
  revision: z.number().int().positive(),
  clearCredential: z.boolean().optional(),
});
const channelDeleteSchema = z.object({ id: z.string().min(1).max(100), revision: z.number().int().positive() });
const upcomingSchema = z.object({ date: z.string().date().optional(), after: z.string().datetime({ offset: true }).optional(), task: z.string().min(1).max(100).optional() });

function toolError(message: string, status = 400): ToolResult {
  const details = { status, error: message };
  return { content: [{ type: "text", text: JSON.stringify(details) }], structuredContent: details, isError: true };
}

function toolSuccess(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function authorized(authorization: string, method: string): boolean {
  return requestIsAuthorized(new Request("http://rubidium.local/api/mcp", { method, headers: { authorization } }));
}

function apiRequest(authorization: string, path: string, method = "GET", body?: unknown, extraHeaders: Record<string, string> = {}): Request {
  const url = new URL(path, "http://rubidium.local");
  const headers = new Headers({ authorization, host: url.host, ...extraHeaders });
  const hasBody = body !== undefined;
  if (hasBody) headers.set("content-type", "application/json");
  if (!["GET", "HEAD"].includes(method)) {
    headers.set("origin", url.origin);
    headers.set("sec-fetch-site", "same-origin");
  }
  return new Request(url, { method, headers, ...(hasBody ? { body: JSON.stringify(body) } : {}) });
}

async function callApi(
  authorization: string,
  method: string,
  path: string,
  handler: ApiRoute,
  body?: unknown,
  context?: { params: Promise<{ id: string }> },
  extraHeaders: Record<string, string> = {},
): Promise<ToolResult> {
  const isWrite = !["GET", "HEAD"].includes(method);
  let response: Response;
  try {
    if (!authorized(authorization, isWrite ? "POST" : "GET")) {
      return toolError(isWrite ? "当前凭据没有写入权限" : "凭据无效或已撤销", isWrite ? 403 : 401);
    }
    response = await handler(apiRequest(authorization, path, method, body, extraHeaders), context ?? { params: Promise.resolve({ id: "" }) });
  } catch (error) {
    if (!(error instanceof DomainError)) logError("mcp.tool.failed", error, { method, path: new URL(path, "http://rubidium.local").pathname });
    response = jsonErrorFrom(error);
  }
  const payload = await response.json().catch(() => ({ error: "服务返回了无效响应" })) as Record<string, unknown>;
  if (!response.ok) return toolError(typeof payload.error === "string" ? payload.error : "请求未完成", response.status);
  return toolSuccess(payload);
}

function createServer(authorization: string): McpServer {
  const server = new McpServer({ name: "rubidium", version: packageMetadata.version }, { maxToolInputElements: 500 });

  server.registerTool("list_tasks", {
    title: "列出提醒",
    description: "按状态和关键词查询提醒。最多每页 50 条。",
    inputSchema: listSchema,
    annotations: { readOnlyHint: true },
  }, async ({ page, pageSize, status, q }) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set("status", status);
    if (q) query.set("q", q);
    return callApi(authorization, "GET", `/api/tasks?${query}`, taskListApi);
  });

  server.registerTool("get_task", {
    title: "读取提醒",
    description: "按提醒 ID 读取单条提醒，不返回设备密钥或访问凭据。",
    inputSchema: idSchema,
    annotations: { readOnlyHint: true },
  }, async ({ id }) => callApi(authorization, "GET", `/api/tasks/${encodeURIComponent(id)}`, async () => {
    const task = getTask(id);
    return task ? Response.json({ task }) : jsonError("任务不存在", 404);
  }));

  server.registerTool("create_task", {
    title: "创建提醒",
    description: "创建提醒；可传 idempotencyKey 避免客户端重试造成重复。timeZone 使用 IANA 时区。",
    inputSchema: taskCreateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ idempotencyKey, ...task }) => callApi(
    authorization, "POST", "/api/tasks", createTaskApi, task, undefined,
    idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
  ));

  server.registerTool("update_task", {
    title: "更新提醒",
    description: "完整更新提醒内容，必须提供当前 revision；版本冲突时需先重新读取。",
    inputSchema: taskUpdateSchema.extend({ id: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, ...task }) => callApi(authorization, "PUT", `/api/tasks/${encodeURIComponent(id)}`, updateTaskApi, task, { params: Promise.resolve({ id }) }));

  server.registerTool("set_task_status", {
    title: "暂停或恢复提醒",
    description: "暂停或恢复提醒，必须提供当前 revision。",
    inputSchema: taskStatusUpdateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, status, revision }) => callApi(authorization, "PATCH", `/api/tasks/${encodeURIComponent(id)}`, updateTaskStatusApi, { status, revision }, { params: Promise.resolve({ id }) }));

  server.registerTool("archive_task", {
    title: "归档提醒",
    description: "归档提醒而不立即删除其历史记录，必须提供当前 revision。",
    inputSchema: archiveSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ id, revision }) => callApi(authorization, "DELETE", `/api/tasks/${encodeURIComponent(id)}`, archiveTaskApi, undefined, { params: Promise.resolve({ id }) }, { "if-match": String(revision) }));

  server.registerTool("list_deliveries", {
    title: "列出投递记录",
    description: "按状态和关键词查询投递记录。最多每页 50 条。",
    inputSchema: deliveryListSchema,
    annotations: { readOnlyHint: true },
  }, async ({ page, pageSize, status, q }) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set("status", status);
    if (q) query.set("q", q);
    return callApi(authorization, "GET", `/api/deliveries?${query}`, listDeliveriesApi);
  });

  server.registerTool("get_delivery_attempts", {
    title: "读取投递尝试",
    description: "读取指定投递记录最近最多 100 次尝试。",
    inputSchema: idSchema,
    annotations: { readOnlyHint: true },
  }, async ({ id }) => callApi(authorization, "GET", `/api/deliveries/${encodeURIComponent(id)}/attempts`, deliveryAttemptsApi, undefined, { params: Promise.resolve({ id }) }));

  server.registerTool("retry_delivery", {
    title: "重试投递",
    description: "将仍处于等待状态的投递加入重试；已发送或已过期的记录会返回冲突。",
    inputSchema: idSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ id }) => callApi(authorization, "POST", `/api/deliveries/${encodeURIComponent(id)}/retry`, retryDeliveryApi, {}, { params: Promise.resolve({ id }) }));

  server.registerTool("cancel_delivery", {
    title: "取消等待投递",
    description: "取消仍处于等待状态的单条投递；发送中或已结束的记录不会被更改。",
    inputSchema: idSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ id }) => callApi(authorization, "POST", `/api/deliveries/${encodeURIComponent(id)}/cancel`, cancelDeliveryApi, {}, { params: Promise.resolve({ id }) }));

  server.registerTool("get_overview", {
    title: "读取工作概览",
    description: "读取排期、统计、近期投递和当前 Bark 地址；不会返回 Device Key。",
    annotations: { readOnlyHint: true },
  }, async () => callApi(authorization, "GET", "/api/overview", overviewApi));

  server.registerTool("list_upcoming", {
    title: "读取近期排期",
    description: "查询未来七天的排期，可按日期筛选或使用 after 与 task 游标翻页。",
    inputSchema: upcomingSchema,
    annotations: { readOnlyHint: true },
  }, async ({ date, after, task }) => {
    const query = new URLSearchParams();
    if (date) query.set("date", date);
    if (after) query.set("after", after);
    if (task) query.set("task", task);
    return callApi(authorization, "GET", `/api/upcoming${query.size ? `?${query}` : ""}`, upcomingApi);
  });

  server.registerTool("list_channels", {
    title: "列出通知渠道",
    description: "列出 Bark 与 Ntfy 渠道及凭据配置状态，不返回凭据原文。",
    annotations: { readOnlyHint: true },
  }, async () => callApi(authorization, "GET", "/api/channels", listChannelsApi));

  server.registerTool("create_channel", {
    title: "创建通知渠道",
    description: "创建 Bark 或 Ntfy 渠道。Bark 需要 Device Key；Ntfy topic 必须符合服务端校验。",
    inputSchema: channelCreateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async (channel) => callApi(authorization, "POST", "/api/channels", createChannelApi, channel));

  server.registerTool("update_channel", {
    title: "更新通知渠道",
    description: "按当前 revision 更新渠道；留空 credential 可保留现有凭据，clearCredential 可清除。",
    inputSchema: channelUpdateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ id, revision, ...channel }) => callApi(
    authorization, "PUT", "/api/channels", updateChannelApi, { id, revision, ...channel },
  ));

  server.registerTool("delete_channel", {
    title: "删除通知渠道",
    description: "按 revision 删除未被任务或待投递记录引用的渠道。默认通知渠道不可删除。",
    inputSchema: channelDeleteSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ id, revision }) => callApi(
    authorization, "DELETE", `/api/channels?id=${encodeURIComponent(id)}`, deleteChannelApi, undefined, undefined,
    { "if-match": String(revision) },
  ));

  server.registerTool("test_channel", {
    title: "测试通知渠道",
    description: "向指定渠道真实发送一条测试通知；不会创建投递历史记录。",
    inputSchema: idSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ id }) => callApi(
    authorization, "POST", `/api/channels/${encodeURIComponent(id)}/test`, testChannelApi, {}, { params: Promise.resolve({ id }) },
  ));

  return server;
}

function unauthorized(): Response {
  return Response.json({ error: "未授权：请提供有效的 Bearer API 凭据" }, { status: 401, headers: { "www-authenticate": "Bearer" } });
}

export const POST = apiRoute(async (request: Request): Promise<Response> => {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorized(authorization, "GET")) return unauthorized();
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const server = createServer(authorization);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
});

function methodNotAllowed(): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, {
    status: 405,
    headers: { allow: "POST", "content-type": "application/json" },
  });
}

export function GET(): Response { return methodNotAllowed(); }
export function DELETE(): Response { return methodNotAllowed(); }
