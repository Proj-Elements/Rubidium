import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "barker-api-"));
process.env.BARKER_DATA_DIR = directory;
process.env.BARKER_PASSWORD = "api-test-password-1234";
process.env.BARKER_SETUP_TOKEN = "";
process.env.BARKER_ALLOW_SETUP = "";
let auth: typeof import("../lib/auth");
let tasks: typeof import("../app/api/tasks/route");
let task: typeof import("../app/api/tasks/[id]/route");
let settings: typeof import("../app/api/settings/route");
let deliveries: typeof import("../app/api/deliveries/route");
let preview: typeof import("../app/api/tasks/preview/route");
let overview: typeof import("../app/api/overview/route");
let session: typeof import("../app/api/session/route");
let database: typeof import("../lib/db");
let health: typeof import("../app/api/health/route");
let cancellation: typeof import("../app/api/deliveries/[id]/cancel/route");
let attempts: typeof import("../app/api/deliveries/[id]/attempts/route");
let deliveryRetry: typeof import("../app/api/deliveries/[id]/retry/route");
let audit: typeof import("../app/api/audit/route");
let devices: typeof import("../app/api/devices/route");
let channels: typeof import("../app/api/channels/route");
let channelTest: typeof import("../app/api/channels/[id]/test/route");
let security: typeof import("../app/api/security/route");
let upcoming: typeof import("../app/api/upcoming/route");
before(async () => {
  auth = await import("../lib/auth"); tasks = await import("../app/api/tasks/route"); task = await import("../app/api/tasks/[id]/route");
  settings = await import("../app/api/settings/route"); deliveries = await import("../app/api/deliveries/route");
  preview = await import("../app/api/tasks/preview/route"); overview = await import("../app/api/overview/route"); session = await import("../app/api/session/route");
  database = await import("../lib/db");
  health = await import("../app/api/health/route");
  cancellation = await import("../app/api/deliveries/[id]/cancel/route");
  attempts = await import("../app/api/deliveries/[id]/attempts/route");
  deliveryRetry = await import("../app/api/deliveries/[id]/retry/route");
  audit = await import("../app/api/audit/route"); devices = await import("../app/api/devices/route");
  channels = await import("../app/api/channels/route"); channelTest = await import("../app/api/channels/[id]/test/route");
  security = await import("../app/api/security/route"); upcoming = await import("../app/api/upcoming/route");
});
after(() => rmSync(directory, { recursive: true, force: true }));

function request(path: string, method = "GET", body?: unknown, authorized = true, extraHeaders: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, { method, headers: { host: "localhost:3000", "content-type": "application/json", ...(authorized ? { cookie: `barker_session=${auth.createSessionToken()}` } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const input = { name: "API reminder", description: "First line\nSecond line", startsAt: "2030-11-05T09:00:00+08:00", preset: "weekdays" as const, cron: "0 9 * * 1-5", repeatCount: 3, endDate: null };

test("all workspace data endpoints reject unauthorized reads and mutations", async () => {
  for (const handler of [tasks.GET, settings.GET, deliveries.GET, overview.GET]) assert.equal((await handler(request("/api", "GET", undefined, false))).status, 401);
  assert.equal((await tasks.POST(request("/api/tasks", "POST", input, false))).status, 401);
  assert.equal((await settings.PUT(request("/api/settings", "PUT", {}, false))).status, 401);
});

test("password login sets an HttpOnly session and logout clears it", async () => {
  const response = await session.POST(request("/api/session", "POST", { password: "api-test-password-1234" }, false));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax/);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const logout = await session.DELETE(request("/api/session", "DELETE", undefined, false, { cookie }));
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await (await session.GET(request("/api/session", "GET", undefined, false, { cookie }))).json()).authenticated, false);
});

test("repeated wrong logins lock out further guesses including correct passwords", async () => {
  let failed: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) failed = await session.POST(request("/api/session", "POST", { password: "wrong password" }, false));
  assert.equal(failed?.status, 429);
  assert.ok(Number(failed?.headers.get("retry-after")) > 0);
  const correct = await session.POST(request("/api/session", "POST", { password: "api-test-password-1234" }, false));
  assert.equal(correct.status, 429);
  const change = await security.POST(request("/api/security", "POST", { action: "password", current: "api-test-password-1234", next: "new-api-test-password" }));
  assert.equal(change.status, 429);
  assert.ok(Number(change.headers.get("retry-after")) > 0);
});

test("settings roundtrip never returns the device key and empty edits preserve it", async () => {
  const value = { endpoint: "https://example.test", deviceKey: "secret-device-key", title: "Barker", sound: "", group: "Barker", icon: "" };
  const revision = database.settingsRevision();
  assert.equal((await settings.PUT(request("/api/settings", "PUT", { ...value, revision }))).status, 200);
  assert.equal((await settings.PUT(request("/api/settings", "PUT", { ...value, revision: revision + 1, deviceKey: "", group: "Personal" }))).status, 200);
  const payload = await (await settings.GET(request("/api/settings"))).json();
  assert.equal(payload.deviceKeyConfigured, true);
  assert.equal(payload.settings.group, "Personal");
  assert.equal(JSON.stringify(payload).includes("secret-device-key"), false);
  assert.equal(payload.settings.deviceKey, undefined);
});

test("create, preview, pause, edit and archive form a complete authenticated workflow", async (testContext) => {
  testContext.mock.timers.enable({ apis: ["Date"], now: new Date(input.startsAt) });
  const previewResponse = await preview.POST(request("/api/tasks/preview", "POST", input));
  assert.equal(previewResponse.status, 200);
  const dates = (await previewResponse.json()).dates;
  assert.equal(dates.length, 3);
  const created = await tasks.POST(request("/api/tasks", "POST", input));
  assert.equal(created.status, 201);
  const entity = (await created.json()).task;
  assert.equal(entity.nextRunAt, dates[0]);
  const context = { params: Promise.resolve({ id: entity.id }) };
  assert.equal((await task.PATCH(request(`/api/tasks/${entity.id}`, "PATCH", { status: "paused", revision: entity.revision }), context)).status, 200);
  assert.equal((await task.PUT(request(`/api/tasks/${entity.id}`, "PUT", { ...input, name: "Updated", revision: entity.revision + 1 }), context)).status, 200);
  assert.equal((await task.DELETE(request(`/api/tasks/${entity.id}`, "DELETE", undefined, true, { "if-match": String(entity.revision + 2) }), context)).status, 200);
  const listing = await (await tasks.GET(request("/api/tasks?status=archived&page=1"))).json();
  assert.equal(listing.tasks[0].name, "Updated");
  assert.equal(listing.tasks[0].status, "archived");
});

test("settings reject stale revisions and endpoint changes without a new key", async () => {
  const previous = database.readSettings();
  const revision = database.settingsRevision();
  assert.equal((await settings.PUT(request("/api/settings", "PUT", { ...previous, revision: revision - 1 }))).status, 409);
  assert.equal((await settings.PUT(request("/api/settings", "PUT", { ...previous, deviceKey: "", endpoint: "https://other.test", revision }))).status, 400);
  assert.equal(database.readSettings().endpoint, previous.endpoint);
});

test("settings can explicitly remove a stored device key without changing the endpoint", async () => {
  const previous = database.readSettings();
  const revision = database.settingsRevision();
  assert.equal((await settings.PUT(request("/api/settings", "PUT", { ...previous, deviceKey: "", clearDeviceKey: true, revision }))).status, 200);
  assert.equal(database.readSettings().deviceKey, "");
  const next = database.settingsRevision();
  assert.equal((await settings.PUT(request("/api/settings", "PUT", { ...previous, deviceKey: "replacement-device-key", revision: next }))).status, 200);
  assert.equal(database.readSettings().deviceKey, "replacement-device-key");
});

test("task mutation requires revisions and idempotent creation does not duplicate a request", async () => {
  const key = "idempotent-task-creation-key";
  const first = await tasks.POST(request("/api/tasks", "POST", input, true, { "idempotency-key": key }));
  const second = await tasks.POST(request("/api/tasks", "POST", input, true, { "idempotency-key": key }));
  const entity = (await first.json()).task;
  assert.equal((await second.json()).task.id, entity.id);
  assert.equal((await tasks.POST(request("/api/tasks", "POST", { ...input, name: "Different" }, true, { "idempotency-key": key }))).status, 409);
  const context = { params: Promise.resolve({ id: entity.id }) };
  assert.equal((await task.PATCH(request(`/api/tasks/${entity.id}`, "PATCH", { status: "paused" }), context)).status, 428);
  assert.equal((await task.PATCH(request(`/api/tasks/${entity.id}`, "PATCH", { status: "paused", revision: 999 }), context)).status, 409);
});

test("database write failures log once with a request ID and return a sanitized 500", async (context) => {
  const logged = context.mock.method(console, "error", () => {});
  const raw = database.__rawDatabaseForTests();
  const authenticatedRequest = request("/api/tasks", "POST", input);
  raw.exec("PRAGMA query_only=ON");
  try {
    const response = await tasks.POST(authenticatedRequest);
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /readonly|sqlite|SQLITE/i);
    assert.equal(logged.mock.callCount(), 1);
    const record = JSON.parse(String(logged.mock.calls[0].arguments[0]));
    assert.equal(record.event, "api.failed");
    assert.equal(record.requestId, response.headers.get("x-request-id"));
  } finally { raw.exec("PRAGMA query_only=OFF"); }
});

test("invalid pagination, dates, limits, and nonexistent task IDs return errors", async () => {
  assert.equal((await tasks.GET(request("/api/tasks?page=Infinity"))).status, 400);
  assert.equal((await deliveries.GET(request("/api/deliveries?pageSize=100000"))).status, 400);
  assert.equal((await tasks.POST(request("/api/tasks", "POST", { ...input, repeatCount: 0 }))).status, 400);
  assert.equal((await preview.POST(request("/api/tasks/preview", "POST", { ...input, endDate: "2020-01-01", repeatCount: null }))).status, 400);
  assert.equal((await task.DELETE(request("/api/tasks/missing", "DELETE"), { params: Promise.resolve({ id: "missing" }) })).status, 404);
  assert.equal((await upcoming.GET(request("/api/upcoming?after=2030-11-05T01:00:00Z"))).status, 400);
  assert.equal((await upcoming.GET(request("/api/upcoming?task=cursor-without-time"))).status, 400);
  assert.equal((await upcoming.GET(request("/api/upcoming?task=invalid-date&after=2030-02-31T01:00:00Z"))).status, 400);
});

test("bulk status writes prevalidate the batch and roll back on storage errors", async () => {
  const first = database.createTask({ ...input, name: "Atomic first" });
  const second = database.createTask({ ...input, name: "Atomic second" });
  const items = [first, second].map(({ id, revision }) => ({ id, revision }));
  const patch = (status: unknown, batch: unknown[]) => tasks.PATCH(request("/api/tasks", "PATCH", { status, items: batch }));
  assert.equal((await patch(["paused"], items)).status, 400);
  assert.equal((await patch("paused", [items[0], null])).status, 400);
  assert.equal(database.getTask(first.id)?.status, "active");
  const raw = database.__rawDatabaseForTests();
  raw.exec("CREATE TRIGGER fail_batch BEFORE UPDATE OF status ON tasks WHEN NEW.name = 'Atomic second' BEGIN SELECT RAISE(ABORT, 'write failed'); END;");
  try {
    assert.equal((await patch("paused", items)).status, 500);
    assert.equal(database.getTask(first.id)?.status, "active");
  } finally { raw.exec("DROP TRIGGER fail_batch"); }
  const response = await patch("paused", [items[0], { ...items[1], revision: items[1].revision + 1 }]);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results.map((item: { success: boolean }) => item.success), [true, false]);
  assert.equal(database.getTask(first.id)?.status, "paused");
  assert.equal(database.getTask(second.id)?.status, "active");
});

test("security audit requires a session and device updates require a non-empty ID", async () => {
  const token = auth.createApiToken("API reader", "read", 1);
  assert.equal((await tasks.GET(request("/api/tasks", "GET", undefined, false, { authorization: `Bearer ${token}` }))).status, 200);
  assert.equal((await audit.GET(request("/api/audit", "GET", undefined, false, { authorization: `Bearer ${token}` }))).status, 401);
  assert.equal((await audit.GET(request("/api/audit"))).status, 200);
  const device = { name: "Test device", endpoint: "https://example.test", deviceKey: "test-device-key" };
  assert.equal((await devices.POST(request("/api/devices", "POST", { ...device, id: "" }))).status, 400);
  assert.equal((await devices.POST(request("/api/devices", "POST", device))).status, 200);
});

test("channel API protects credentials, checks revisions, and tests without queue records", async (context) => {
  const payload = {
    name: "API Ntfy", type: "ntfy", endpoint: "https://ntfy.example/base", topic: "api_alerts", credential: "private-channel-token",
  };
  assert.equal((await channels.GET(request("/api/channels", "GET", undefined, false))).status, 401);
  const readToken = auth.createApiToken("Channel reader", "read", 0);
  assert.equal((await channels.GET(request("/api/channels", "GET", undefined, false, { authorization: `Bearer ${readToken}` }))).status, 200);
  assert.equal((await channels.POST(request("/api/channels", "POST", payload, false, { authorization: `Bearer ${readToken}` }))).status, 401);
  assert.equal((await channels.POST(request("/api/channels", "POST", { ...payload, topic: "not valid" }))).status, 400);

  const createdResponse = await channels.POST(request("/api/channels", "POST", payload));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).channel;
  assert.equal(created.credentialConfigured, true);
  assert.equal(JSON.stringify(created).includes(payload.credential), false);
  const listing = await (await channels.GET(request("/api/channels"))).json();
  assert.equal(JSON.stringify(listing).includes(payload.credential), false);
  assert.ok(listing.channels.some((channel: { id: string }) => channel.id === created.id));

  const update = { ...payload, id: created.id, credential: "", revision: created.revision };
  assert.equal((await channels.PUT(request("/api/channels", "PUT", { ...update, revision: 999 }))).status, 409);
  const updatedResponse = await channels.PUT(request("/api/channels", "PUT", { ...update, name: "API Ntfy Updated" }));
  assert.equal(updatedResponse.status, 200);
  const updated = (await updatedResponse.json()).channel;
  assert.equal(updated.name, "API Ntfy Updated");
  assert.equal(updated.credentialConfigured, true);

  const raw = database.__rawDatabaseForTests();
  const before = Number(raw.prepare("SELECT COUNT(*) AS count FROM deliveries").get()?.count);
  const fetchMock = context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://ntfy.example/base/api_alerts");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${payload.credential}`);
    return new Response(null, { status: 200 });
  });
  const tested = await channelTest.POST(request(`/api/channels/${created.id}/test`, "POST", {}), { params: Promise.resolve({ id: created.id }) });
  assert.equal(tested.status, 200);
  assert.equal((await tested.json()).delivered, true);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM deliveries").get()?.count), before);

  const clearedResponse = await channels.PUT(request("/api/channels", "PUT", {
    ...update, revision: updated.revision, clearCredential: true,
  }));
  assert.equal(clearedResponse.status, 200);
  const cleared = (await clearedResponse.json()).channel;
  assert.equal(cleared.credentialConfigured, false);
  assert.equal(JSON.stringify(cleared).includes(payload.credential), false);

  assert.equal((await channels.DELETE(request(`/api/channels?id=${created.id}`, "DELETE", undefined, true, { "if-match": String(updated.revision) }))).status, 409);
  assert.equal((await channels.DELETE(request(`/api/channels?id=${created.id}`, "DELETE", undefined, true, { "if-match": String(cleared.revision) }))).status, 200);

  const defaultChannel = listing.channels.find((channel: { isDefault: boolean }) => channel.isDefault);
  const defaultUpdate = await channels.PUT(request("/api/channels", "PUT", {
    id: "default", name: defaultChannel.name, type: "bark", endpoint: defaultChannel.endpoint, topic: "", credential: "default-channel-secret", revision: defaultChannel.revision,
  }));
  assert.equal(defaultUpdate.status, 200);
  const configuredDefault = (await defaultUpdate.json()).channel;
  assert.equal(JSON.stringify(configuredDefault).includes("default-channel-secret"), false);
  const clearedDefault = await channels.PUT(request("/api/channels", "PUT", {
    id: "default", name: configuredDefault.name, type: "bark", endpoint: configuredDefault.endpoint, topic: "", credential: "", clearCredential: true, revision: configuredDefault.revision,
  }));
  assert.equal(clearedDefault.status, 200);
  assert.equal((await clearedDefault.json()).channel.credentialConfigured, false);
});

test("API credentials support permanent validity without changing finite expiry", async () => {
  const create = (name: string, days: number) => security.POST(request("/api/security", "POST", { action: "token", name, scope: "read", days }));
  const permanentResponse = await create("Permanent API token", 0);
  assert.equal(permanentResponse.status, 200);
  const permanent = (await permanentResponse.json()).token as string;
  const permanentRequest = () => new Request("http://localhost/api/tasks", { headers: { authorization: `Bearer ${permanent}` } });
  assert.equal(auth.requestIsAuthorized(permanentRequest()), true);

  const finiteResponse = await create("Finite API token", 1);
  assert.equal(finiteResponse.status, 200);
  const finite = (await finiteResponse.json()).token as string;
  const raw = database.__rawDatabaseForTests();
  raw.prepare("UPDATE api_tokens SET expires_at = ? WHERE name = ?").run(Date.now() - 1, "Finite API token");
  assert.equal(auth.requestIsAuthorized(new Request("http://localhost/api/tasks", { headers: { authorization: `Bearer ${finite}` } })), false);

  const state = await (await security.GET(request("/api/security"))).json();
  assert.equal(state.tokens.some((item: { name: string }) => item.name === "Finite API token"), false);
  assert.equal(state.tokens.find((item: { name: string }) => item.name === "Permanent API token").expiresAt, 0);
  assert.equal((await create("Cleanup API token", 0)).status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM api_tokens WHERE name = ?").get("Finite API token")?.count, 0);
  assert.equal(auth.requestIsAuthorized(permanentRequest()), true);

  for (const days of [-1, 366, 1.5]) assert.equal((await create(`Invalid ${days}`, days)).status, 400);
});

test("browser sessions are capped, expired entries are cleaned, and listings are paginated", async () => {
  const raw = database.__rawDatabaseForTests();
  raw.exec("DELETE FROM sessions");
  const tokens = Array.from({ length: 23 }, () => auth.createSessionToken());
  const sessionId = (token: string) => JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).id as string;
  const cookie = `barker_session=${tokens.at(-1)}`;
  raw.prepare("INSERT INTO sessions (id, expires_at, fingerprint) VALUES (?, ?, ?)").run("expired-session", Date.now() - 1, "expired-fingerprint");
  const getPage = async (page: string) => security.GET(new Request(`http://localhost:3000/api/security?page=${page}`, {
    headers: { host: "localhost:3000", cookie },
  }));

  const first = await getPage("1");
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.deepEqual(firstPayload.sessionPagination, { page: 1, pageSize: 10, total: 23 });
  assert.equal(firstPayload.sessions.length, 10);
  assert.equal(firstPayload.sessions[0].id, sessionId(tokens[22]));
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM sessions WHERE id = 'expired-session'").get()?.count, 0);

  const secondPayload = await (await getPage("2")).json();
  assert.equal(secondPayload.sessionPagination.page, 2);
  assert.equal(secondPayload.sessions.length, 10);
  assert.equal(firstPayload.sessions.some((item: { id: string }) => secondPayload.sessions.some((next: { id: string }) => next.id === item.id)), false);
  const clamped = await (await getPage("999")).json();
  assert.deepEqual(clamped.sessionPagination, { page: 3, pageSize: 10, total: 23 });
  assert.equal(clamped.sessions.length, 3);
  for (const value of ["0", "Infinity", "1.5"]) assert.equal((await getPage(value)).status, 400);

  raw.exec("DELETE FROM sessions");
  const recentTokens = Array.from({ length: 105 }, () => auth.createSessionToken());
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM sessions").get()?.count, 100);
  assert.equal(raw.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sessionId(recentTokens[0])), undefined);
  assert.ok(raw.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sessionId(recentTokens.at(-1)!)));

  const insertLegacySession = raw.prepare("INSERT INTO sessions (id, expires_at, fingerprint) VALUES (?, ?, ?)");
  for (let index = 0; index < 10; index += 1) insertLegacySession.run(`legacy-session-${index}`, Date.now() + 60_000, "legacy-fingerprint");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM sessions").get()?.count, 110);
  const bounded = await security.GET(new Request("http://localhost:3000/api/security?page=1", {
    headers: { host: "localhost:3000", cookie: `barker_session=${recentTokens.at(-1)}` },
  }));
  assert.equal(bounded.status, 200);
  assert.deepEqual((await bounded.json()).sessionPagination, { page: 1, pageSize: 10, total: 100 });
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM sessions").get()?.count, 100);
  assert.equal(raw.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sessionId(recentTokens[5])), undefined);
});

test("health requires a writable database and a fresh enabled scheduler", async () => {
  const previous = process.env.BARKER_DISABLE_SCHEDULER;
  const raw = database.__rawDatabaseForTests();
  try {
    process.env.BARKER_DISABLE_SCHEDULER = "1";
    database.writeRuntimeState("scheduler_heartbeat", String(Date.now()));
    assert.equal((await health.GET()).status, 503);
    delete process.env.BARKER_DISABLE_SCHEDULER;
    assert.equal((await health.GET()).status, 200);
    raw.exec("PRAGMA query_only=ON");
    assert.equal((await health.GET()).status, 503);
    raw.exec("PRAGMA query_only=OFF");
    database.writeRuntimeState("scheduler_heartbeat", String(Date.now() - 16_000));
    assert.equal((await health.GET()).status, 503);
    database.writeRuntimeState("scheduler_heartbeat", String(Date.now() + 60_000));
    assert.equal((await health.GET()).status, 503);
  } finally {
    raw.exec("PRAGMA query_only=OFF");
    if (previous === undefined) delete process.env.BARKER_DISABLE_SCHEDULER;
    else process.env.BARKER_DISABLE_SCHEDULER = previous;
  }
});

test("authentication storage failures return 500 rather than logging the user out", async () => {
  const authenticated = request("/api/tasks");
  const raw = database.__rawDatabaseForTests();
  raw.exec("ALTER TABLE sessions RENAME TO sessions_unavailable");
  try { assert.equal((await tasks.GET(authenticated)).status, 500); }
  finally { raw.exec("ALTER TABLE sessions_unavailable RENAME TO sessions"); }
});

test("delivery cancellation and attempt history follow authentication and retention contracts", async () => {
  const reminder = database.createTask({ ...input, name: "Cancellation API", preset: "daily", cron: "0 9 * * *", startsAt: "2030-11-05T09:00:00+08:00" });
  database.queueTaskBatch(reminder.id, new Date(reminder.nextRunAt!), 1);
  const item = database.listDeliveries({ page: 1, pageSize: 10, q: "Cancellation API" }).deliveries[0];
  const context = { params: Promise.resolve({ id: item.id }) };
  const historyPath = `/api/deliveries/${item.id}/attempts`;
  const cancelPath = `/api/deliveries/${item.id}/cancel`;
  assert.equal((await attempts.GET(request(historyPath, "GET", undefined, false), context)).status, 401);
  assert.equal((await cancellation.POST(request(cancelPath, "POST", {}, false), context)).status, 401);
  assert.equal((await cancellation.POST(request(cancelPath, "POST", {}, true, { origin: "https://evil.example" }), context)).status, 403);
  assert.deepEqual(await (await attempts.GET(request(historyPath), context)).json(), { attempts: [] });
  assert.equal((await deliveries.PATCH(request("/api/deliveries", "PATCH", { action: ["cancel"], ids: [item.id] }))).status, 400);
  assert.equal((await cancellation.POST(request("/api/deliveries/missing/cancel", "POST", {}), { params: Promise.resolve({ id: "missing" }) })).status, 404);
  assert.equal((await cancellation.POST(request(cancelPath, "POST", {}), context)).status, 200);
  assert.equal((await cancellation.POST(request(cancelPath, "POST", {}), context)).status, 409);
  const listing = await (await deliveries.GET(request("/api/deliveries?status=cancelled&q=Cancellation%20API&page=999"))).json();
  assert.equal(listing.page, 1);
  assert.equal(listing.total, 1);
  assert.equal(listing.deliveries[0].taskName, "Cancellation API");
  assert.equal(database.getTask(reminder.id)?.queuedCount, 1);
  assert.equal(database.getTask(reminder.id)?.sentCount, 0);
});

test("delivery retry distinguishes a missing record from a state conflict", async () => {
  const missing = await deliveryRetry.POST(request("/api/deliveries/missing/retry", "POST", {}), { params: Promise.resolve({ id: "missing" }) });
  assert.equal(missing.status, 404);
  const reminder = database.createTask({ ...input, name: "Retry status API", preset: "daily", cron: "0 9 * * *", startsAt: "2030-11-05T09:00:00+08:00" });
  database.queueTaskBatch(reminder.id, new Date(reminder.nextRunAt!), 1);
  const item = database.listDeliveries({ page: 1, pageSize: 10, q: "Retry status API" }).deliveries[0];
  database.__rawDatabaseForTests().prepare("UPDATE deliveries SET status = 'sent' WHERE id = ?").run(item.id);
  const conflict = await deliveryRetry.POST(request(`/api/deliveries/${item.id}/retry`, "POST", {}), { params: Promise.resolve({ id: item.id }) });
  assert.equal(conflict.status, 409);
});
