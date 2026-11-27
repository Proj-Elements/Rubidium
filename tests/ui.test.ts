import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ApiError, clientPresetCron, createIdempotencyKey, duplicateStart, errorMessage, formatTime, localInputValue, toOffsetDateTime, validApiPayload } from "../lib/ui";
import { createResourcePoller } from "../lib/resource";

test("API clients reject HTML or structurally invalid success payloads", () => {
  assert.equal(validApiPayload("/api/tasks", { tasks: [] }), true);
  assert.equal(validApiPayload("/api/overview", {
    tasks: [], upcoming: [], upcomingDays: [], recent: [], activity: [], stats: { active: 0, paused: 0, todaySent: 0, totalSent: 0 },
    deliveries: { pending: 0, retrying: 0, nextRetryAt: null }, endpoint: "https://api.day.app", deviceKeyConfigured: false,
    defaultChannel: { type: "bark", credentialConfigured: false }, serverTime: "2030-01-01T00:00:00Z",
  }), true);
  assert.equal(validApiPayload("/api/tasks", {}), false);
  assert.equal(validApiPayload("/api/session", { authenticated: false }), true);
  assert.equal(validApiPayload("/api/session", { authenticated: false, initialized: false, setupEnabled: true, setupTokenRequired: true }), true);
  assert.equal(validApiPayload("/api/session", { authenticated: false, initialized: false, setupEnabled: true }), false);
  assert.equal(validApiPayload("/api/deliveries", { deliveries: "not-an-array", total: 0 }), false);
  assert.equal(validApiPayload("/api/tasks/preview", { dates: ["not-a-date"] }), false);
  assert.equal(validApiPayload("/api/tasks/preview", { dates: ["2030-02-31T01:00:00Z"] }), false);
  assert.equal(validApiPayload("/api/tasks/preview", { dates: ["2030-02-28T01:00:00Z"] }), true);
  assert.equal(validApiPayload("/api/settings/test", { delivered: false }), false);
  assert.equal(validApiPayload("/api/overview", { tasks: [], upcoming: [], upcomingDays: [], recent: [], activity: [], stats: {}, deliveries: {}, serverTime: "2030-01-01T00:00:00Z" }), false);
  assert.equal(validApiPayload("/api/overview", {
    tasks: [], upcoming: [], upcomingDays: [], recent: [], activity: [], stats: { active: 0, paused: 0, todaySent: 0, totalSent: 0 },
    deliveries: { pending: 0, retrying: 0, nextRetryAt: null }, endpoint: "https://api.day.app", deviceKeyConfigured: false,
    defaultChannel: { type: "smtp", credentialConfigured: false }, serverTime: "2030-01-01T00:00:00Z",
  }), false);
  assert.equal(validApiPayload("/api/settings", { tasks: [] }), false);
  assert.equal(validApiPayload("/api/tasks", { tasks: [{ id: "incomplete" }] }), false);
  assert.equal(validApiPayload("/api/deliveries", { deliveries: [], total: 0, page: Infinity, pageSize: 12 }), false);
  const channel = { id: "channel", name: "Ntfy", type: "ntfy", endpoint: "https://ntfy.example", topic: "alerts", credentialConfigured: true, revision: 1, isDefault: false };
  assert.equal(validApiPayload("/api/channels", { channels: [channel] }), true);
  assert.equal(validApiPayload("/api/channels", { channel: { ...channel, credential: "secret" } }), false);
  assert.equal(validApiPayload("/api/channels", { channels: [{ ...channel, revision: 0 }] }), false);
  assert.equal(validApiPayload("/api/channels/id/test", { delivered: true }), true);
});

test("the actual API client rejects HTML and malformed JSON success responses", async (context) => {
  const fetcher = context.mock.method(globalThis, "fetch", async () => new Response("<html>gateway</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(api("/api/tasks"), (error: unknown) => error instanceof ApiError && /非 JSON/.test(error.message));
  fetcher.mock.mockImplementation(async () => new Response("{", { headers: { "content-type": "application/json" } }));
  await assert.rejects(api("/api/tasks"), /损坏/);
  fetcher.mock.mockImplementation(async () => Response.json({}));
  await assert.rejects(api("/api/tasks"), /格式无效/);
});

test("API error keys and interpolation values are localized without inspecting server prose", async (context) => {
  const fetcher = context.mock.method(globalThis, "fetch", async () => Response.json({
    error: "密码长度不足（至少 8 个字符，当前 5 个）", errorKey: "password.tooShort", errorValues: { minimum: 8, count: 5 },
  }, { status: 400 }));
  await assert.rejects(api("/api/session"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(errorMessage(error, "en"), "Password is too short (minimum 8 characters; currently 5).");
    assert.equal(errorMessage(error, "zh-TW"), "至少需要 8 個字元（目前 5 個）");
    return true;
  });
  fetcher.mock.mockImplementation(async () => Response.json({ error: "server text", errorKey: "unknown.key" }, { status: 400 }));
  await assert.rejects(api("/api/session"), (error: unknown) => error instanceof ApiError && !error.localized);
});

test("invalid task limits and calendar dates cannot reach rendering or the editor", () => {
  const task = {
    id: "task", name: "Reminder", description: "", cron: "0 9 * * *", timeZone: "Asia/Shanghai", preset: "daily", status: "active",
    sentCount: 0, queuedCount: 0, pendingCount: 0, repeatCount: 3, endDate: null, maxLatenessMinutes: null, revision: 1,
    startsAt: "2030-01-01T01:00:00Z", createdAt: "2030-01-01T00:00:00Z", updatedAt: "2030-01-01T00:00:00Z",
    nextRunAt: "2030-01-01T01:00:00Z", lastRunAt: null, pausedAt: null, lastError: null,
  };
  assert.equal(validApiPayload("/api/tasks", { tasks: [task] }), true);
  for (const patch of [{ repeatCount: {} }, { repeatCount: -1 }, { endDate: "2030-02-31" }, { maxLatenessMinutes: "60" }]) {
    assert.equal(validApiPayload("/api/tasks", { tasks: [{ ...task, ...patch }] }), false);
  }
});

test("a request slower than the poll interval finishes before another poll starts", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let release!: (value: string) => void;
  const received: string[] = [];
  const poller = createResourcePoller({ interval: 5000, visible: () => true,
    load: async () => { calls += 1; return new Promise<string>((resolve) => { release = resolve; }); },
    data: (value) => received.push(value), error: (error) => { throw error; } });
  try {
    const first = poller.refresh();
    await new Promise<void>((resolve) => setImmediate(resolve));
    context.mock.timers.tick(15_000);
    assert.equal(calls, 1);
    release("slow response"); await first;
    assert.deepEqual(received, ["slow response"]);
    context.mock.timers.tick(5000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    release("next response");
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally { poller.stop(); }
});

test("refresh requested during an in-flight GET performs a follow-up GET", async () => {
  const releases: Array<(value: number) => void> = [];
  const received: number[] = [];
  const poller = createResourcePoller({ interval: 0, visible: () => true,
    load: () => new Promise<number>((resolve) => releases.push(resolve)), data: (value) => received.push(value), error: (error) => { throw error; } });
  try {
    const first = poller.refresh();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const afterSave = poller.refresh();
    releases[0](1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 2);
    releases[1](2);
    await Promise.all([first, afterSave]);
    assert.deepEqual(received, [1, 2]);
  } finally { poller.stop(); }
});

test("poller recovers from synchronous errors and discards late data after stop", async () => {
  let calls = 0;
  let errors = 0;
  let received = 0;
  let release!: (value: number) => void;
  const poller = createResourcePoller({ interval: 0, visible: () => true,
    load: () => { if (++calls === 1) throw new Error("offline"); return new Promise<number>((resolve) => { release = resolve; }); },
    data: () => { received += 1; }, error: () => { errors += 1; } });
  await poller.refresh();
  assert.equal(errors, 1);
  const next = poller.refresh();
  await new Promise<void>((resolve) => setImmediate(resolve));
  poller.stop(); release(42); await next;
  assert.equal(calls, 2);
  assert.equal(received, 0);
});

test("task wall-clock conversion keeps preset days and rejects nonexistent DST times", () => {
  assert.equal(clientPresetCron("weekly", "2030-11-04T09:30"), "30 9 * * 1");
  assert.equal(clientPresetCron("daily", "not-a-date"), "");
  assert.equal(toOffsetDateTime("2026-03-08T02:30", "America/New_York"), "");
  assert.equal(toOffsetDateTime("2026-11-01T01:30", "America/New_York"), "2026-11-01T05:30:00.000Z");
});

test("wall-clock conversion preserves an unchanged saved instant in a DST overlap", () => {
  const convert: (value: string, timeZone: string, savedInstant?: string) => string = toOffsetDateTime;
  const secondOccurrence = "2026-11-01T06:30:00.000Z";
  assert.equal(convert("2026-11-01T01:30", "America/New_York", secondOccurrence), secondOccurrence);
  assert.equal(convert("2026-11-01T01:31", "America/New_York", secondOccurrence), "2026-11-01T05:31:00.000Z");
  assert.equal(convert("2026-11-01T01:30", "UTC", secondOccurrence), "2026-11-01T01:30:00.000Z");
  assert.equal(convert("2026-03-08T02:30", "America/New_York", secondOccurrence), "");
  assert.equal(convert("2026-11-01T01:30", "America/New_York", "invalid"), "2026-11-01T05:30:00.000Z");
  assert.equal(convert("2026-11-01T01:30", "America/New_York", "2026-11-01T01:30:59-05:00"), secondOccurrence);
  assert.equal(convert("2026-04-05T01:45", "Australia/Lord_Howe", "2026-04-04T15:15:00.000Z"), "2026-04-04T15:15:00.000Z");
  assert.equal(convert("2026-04-05T01:45", "Australia/Lord_Howe"), "2026-04-04T14:45:00.000Z");
  assert.equal(convert("2026-10-04T02:15", "Australia/Lord_Howe"), "");
  assert.equal(convert("2030-11-04T09:00", "Asia/Kathmandu"), "2030-11-04T03:15:00.000Z");
});

test("wall-clock conversion rejects invalid zones rather than substituting Shanghai", () => {
  assert.equal(toOffsetDateTime("2030-11-04T09:00", "Mars/Olympus"), "");
  assert.equal(toOffsetDateTime("2030-11-04T09:00", "+08:00"), "");
});

test("corrupt stored dates and timezones cannot crash the task editor", () => {
  assert.equal(localInputValue(new Date("invalid"), "Mars/Olympus"), "");
  assert.equal(localInputValue(new Date("2030-06-01T22:00:00Z"), "Mars/Olympus"), "2030-06-02T06:00");
  assert.equal(toOffsetDateTime("2026-02-31T09:30"), "");
  assert.equal(formatTime("invalid"), "时间无效");
});

test("duplicating a task preserves its wall clock in the task timezone", () => {
  const duplicate = duplicateStart({
    startsAt: "2030-11-03T14:00:00.000Z",
    nextRunAt: "2030-11-03T15:00:00.000Z",
    timeZone: "UTC",
  });
  assert.equal(duplicate, "2030-11-03T15:00");
});

test("idempotency keys are generated in the API's accepted format", () => {
  assert.match(createIdempotencyKey(), /^[A-Za-z0-9_-]{16,128}$/);
});
