import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { after, before, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "rubidium-mcp-"));
process.env.RUBIDIUM_DATA_DIR = directory;
process.env.RUBIDIUM_PASSWORD = "mcp-test-password-1234";
process.env.RUBIDIUM_SETUP_TOKEN = "";
process.env.RUBIDIUM_ALLOW_SETUP = "";

let auth: typeof import("../lib/auth");
let database: typeof import("../lib/db");
let mcp: typeof import("../app/api/mcp/route");

before(async () => {
  auth = await import("../lib/auth");
  database = await import("../lib/db");
  mcp = await import("../app/api/mcp/route");
});

after(() => rmSync(directory, { recursive: true, force: true }));

function token(scope: "read" | "write"): string {
  return auth.createApiToken(`MCP ${scope}`, scope, 0);
}

async function rpc(authorization: string, method: string, params: Record<string, unknown> = {}, id = 1): Promise<Response> {
  return mcp.POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${authorization}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }));
}

async function callTool(authorization: string, name: string, args: Record<string, unknown>, id = 1) {
  const response = await rpc(authorization, "tools/call", { name, arguments: args }, id);
  assert.equal(response.status, 200);
  return await response.json() as { result: { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean } };
}

const task = {
  name: "MCP test reminder",
  description: "",
  startsAt: "2030-11-05T09:00:00+08:00",
  preset: "weekdays",
  cron: "0 9 * * 1-5",
  repeatCount: 3,
  endDate: null,
  timeZone: "Asia/Shanghai",
};

test("MCP requires a valid Bearer API credential and exposes tools through Streamable HTTP", async () => {
  const unauthenticated = await mcp.POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
  }));
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("www-authenticate"), "Bearer");

  const readToken = token("read");
  const initialized = await rpc(readToken, "initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "rubidium-test", version: "1.0" },
  });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json() as { result: { serverInfo: { name: string } } }).result.serverInfo.name, "rubidium");

  const tools = await rpc(readToken, "tools/list");
  assert.equal(tools.status, 200);
  const names = ((await tools.json() as { result: { tools: Array<{ name: string }> } }).result.tools).map(({ name }) => name);
  assert.ok(names.includes("list_tasks"));
  assert.ok(names.includes("create_task"));
  assert.ok(names.includes("archive_task"));
});

test("read-only credentials cannot create tasks, while write credentials use the existing API validation", async () => {
  const readResult = await callTool(token("read"), "create_task", task);
  assert.equal(readResult.result.isError, true);
  assert.equal(readResult.result.structuredContent?.status, 403);
  assert.equal(database.listTasks().length, 0);

  const writeToken = token("write");
  const invalid = await callTool(writeToken, "create_task", { ...task, cron: "not-a-cron" });
  assert.equal(invalid.result.isError, true);
  assert.equal(invalid.result.structuredContent?.status, 400);
  assert.equal(database.listTasks().length, 0);

  const created = await callTool(writeToken, "create_task", task, 2);
  assert.equal(created.result.isError, undefined);
  const entity = created.result.structuredContent?.task as { id: string; revision: number };
  assert.ok(entity.id);
  assert.equal(database.listTasks().length, 1);

  const listing = await callTool(token("read"), "list_tasks", {});
  assert.equal(listing.result.isError, undefined);
  assert.equal((listing.result.structuredContent?.tasks as unknown[]).length, 1);
});

test("MCP rejects unsupported HTTP methods and preserves revision conflicts", async () => {
  const method = mcp.GET();
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");

  const writeToken = token("write");
  const created = await callTool(writeToken, "create_task", task);
  const entity = created.result.structuredContent?.task as { id: string; revision: number };
  const stale = await callTool(writeToken, "set_task_status", { id: entity.id, status: "paused", revision: entity.revision + 1 });
  assert.equal(stale.result.isError, true);
  assert.equal(stale.result.structuredContent?.status, 409);
  assert.equal(database.getTask(entity.id)?.status, "active");
});

test("MCP channel tools enforce scope, hide credentials, and test without delivery history", async (context) => {
  const readToken = token("read");
  const toolsResponse = await rpc(readToken, "tools/list");
  const names = ((await toolsResponse.json() as { result: { tools: Array<{ name: string }> } }).result.tools).map(({ name }) => name);
  for (const name of ["list_channels", "create_channel", "update_channel", "delete_channel", "test_channel"]) assert.ok(names.includes(name));
  assert.equal((await callTool(readToken, "create_channel", {
    name: "MCP Ntfy", type: "ntfy", endpoint: "https://ntfy.example", topic: "mcp_alerts", credential: "private-mcp-channel-token",
  })).result.structuredContent?.status, 403);
  assert.equal(database.listChannels().length, 1);

  const writeToken = token("write");
  const input = { name: "MCP Ntfy", type: "ntfy", endpoint: "https://ntfy.example", topic: "mcp_alerts", credential: "private-mcp-channel-token" };
  const createdResult = await callTool(writeToken, "create_channel", input);
  assert.equal(createdResult.result.isError, undefined);
  assert.equal(JSON.stringify(createdResult).includes(input.credential), false);
  const created = createdResult.result.structuredContent?.channel as { id: string; revision: number; credentialConfigured: boolean };
  assert.equal(created.credentialConfigured, true);

  const stale = await callTool(writeToken, "update_channel", { ...input, id: created.id, revision: created.revision + 1 });
  assert.equal(stale.result.isError, true);
  assert.equal(stale.result.structuredContent?.status, 409);

  const raw = database.__rawDatabaseForTests();
  const before = Number(raw.prepare("SELECT COUNT(*) AS count FROM deliveries").get()?.count);
  const fetchMock = context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://ntfy.example/mcp_alerts");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${input.credential}`);
    return new Response(null, { status: 200 });
  });
  const readOnlyTest = await callTool(readToken, "test_channel", { id: created.id });
  assert.equal(readOnlyTest.result.isError, true);
  assert.equal(readOnlyTest.result.structuredContent?.status, 403);
  const tested = await callTool(writeToken, "test_channel", { id: created.id });
  assert.equal(tested.result.isError, undefined);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM deliveries").get()?.count), before);

  const clearedResult = await callTool(writeToken, "update_channel", {
    ...input, id: created.id, revision: created.revision, credential: "", clearCredential: true,
  });
  assert.equal(clearedResult.result.isError, undefined);
  const cleared = clearedResult.result.structuredContent?.channel as { revision: number; credentialConfigured: boolean };
  assert.equal(cleared.credentialConfigured, false);
  assert.equal(JSON.stringify(clearedResult).includes(input.credential), false);

  const deleted = await callTool(writeToken, "delete_channel", { id: created.id, revision: cleared.revision });
  assert.equal(deleted.result.isError, undefined);
  assert.equal(database.listChannels().length, 1);
});

test("MCP authentication storage failures return sanitized JSON with a request ID", async (context) => {
  const readToken = token("read");
  const logged = context.mock.method(console, "error", () => {});
  const raw = database.__rawDatabaseForTests();
  raw.exec("ALTER TABLE api_tokens RENAME TO api_tokens_unavailable");
  try {
    const response = await rpc(readToken, "tools/list");
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /SQLITE|no such table|api_tokens/);
    assert.ok(response.headers.get("x-request-id"));
    assert.equal(logged.mock.callCount(), 1);
    const record = JSON.parse(String(logged.mock.calls[0].arguments[0]));
    assert.equal(record.requestId, response.headers.get("x-request-id"));
    assert.equal(record.path, "/api/mcp");
  } finally {
    raw.exec("ALTER TABLE api_tokens_unavailable RENAME TO api_tokens");
  }
});

test("MCP get_task applies the same sanitized failure contract as API-backed tools", async (context) => {
  const readToken = token("read");
  const missing = await callTool(readToken, "get_task", { id: "missing-task" });
  assert.equal(missing.result.structuredContent?.status, 404);

  const logged = context.mock.method(console, "error", () => {});
  const raw = database.__rawDatabaseForTests();
  raw.exec("ALTER TABLE tasks RENAME TO tasks_unavailable");
  try {
    const result = await callTool(readToken, "get_task", { id: "missing-task" });
    assert.doesNotMatch(JSON.stringify(result), /SQLITE|no such table|tasks_unavailable/);
    assert.equal(result.result.isError, true);
    assert.equal(result.result.structuredContent?.status, 500);
    assert.equal(logged.mock.callCount(), 1);
  } finally {
    raw.exec("ALTER TABLE tasks_unavailable RENAME TO tasks");
  }
});

test("MCP sanitizes permission lookup failures during a tool call", async (context) => {
  const readToken = token("read");
  const { statement } = await import("../lib/db/core");
  const lookup = statement("SELECT 1 FROM api_tokens WHERE digest = ? AND (expires_at = ? OR expires_at > ?) AND (scope = 'write' OR ? = 0)");
  const get = lookup.get.bind(lookup);
  let lookups = 0;
  context.mock.method(lookup, "get", (...bindings: SQLInputValue[]) => {
    if (++lookups === 2) throw new Error("SQLITE_IOERR: /private/data/token-file");
    return get(...bindings);
  });
  const logged = context.mock.method(console, "error", () => {});
  const result = await callTool(readToken, "list_tasks", {});
  assert.doesNotMatch(JSON.stringify(result), /SQLITE|private|token-file/);
  assert.equal(result.result.structuredContent?.status, 500);
  assert.equal(result.result.isError, true);
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(lookups, 2);
});

test("MCP rejects cross-origin tool calls and cookie-only authentication", async () => {
  const writeToken = token("write");
  const count = database.listTasks().length;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_task", arguments: task } });
  const headers = {
    host: "localhost:3000",
    authorization: `Bearer ${writeToken}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-03-26",
  };
  const originCases: Record<string, string>[] = [
    { origin: "https://other.example" },
    { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
  ];
  for (const originHeaders of originCases) {
    const response = await mcp.POST(new Request("http://localhost:3000/api/mcp", {
      method: "POST", headers: { ...headers, ...originHeaders }, body,
    }));
    assert.equal(response.status, 403);
    assert.equal(database.listTasks().length, count);
  }

  const sameOrigin = await mcp.POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST", headers: { ...headers, origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }));
  assert.equal(sameOrigin.status, 200);

  const cookieOnly = await mcp.POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST", headers: { ...headers, authorization: "", cookie: `barker_session=${auth.createSessionToken()}` }, body,
  }));
  assert.equal(cookieOnly.status, 401);
});

test("MCP accepts case-insensitive Bearer schemes and still rejects read-only tool writes", async () => {
  const readToken = token("read");
  const count = database.listTasks().length;
  const response = await mcp.POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      authorization: `bEaReR ${readToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_task", arguments: task } }),
  }));
  assert.equal(response.status, 200);
  const result = (await response.json()).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 403);
  assert.equal(database.listTasks().length, count);
});

test("MCP accepts both declared date-override limits while bounding excess input elements", async () => {
  const dates = (year: number) => Array.from({ length: 366 }, (_, index) => new Date(Date.UTC(year, 0, 1) + index * 86_400_000).toISOString().slice(0, 10));
  const input = { ...task, skipDates: dates(2029), includeDates: dates(2031) };
  const { taskInputSchema } = await import("../lib/validation");
  assert.equal(taskInputSchema.safeParse(input).success, true);

  const writeToken = token("write");
  const created = await callTool(writeToken, "create_task", input);
  assert.equal(created.result.isError, undefined);
  const entity = created.result.structuredContent?.task as { id: string; skipDates: string[]; includeDates: string[] };
  assert.equal(entity.skipDates.length, 366);
  assert.equal(entity.includeDates.length, 366);
  assert.ok(database.getTask(entity.id));

  const count = database.listTasks().length;
  const excess = { ...input, ...Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`extra_${index}`, null])) };
  const rejected = await callTool(writeToken, "create_task", excess);
  assert.equal(rejected.result.isError, true);
  assert.equal(database.listTasks().length, count);
});
