import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "rubidium-mcp-"));
process.env.BARKER_DATA_DIR = directory;
process.env.BARKER_PASSWORD = "mcp-test-password-1234";

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
