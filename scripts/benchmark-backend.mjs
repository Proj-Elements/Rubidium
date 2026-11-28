import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Always use an isolated database, including when invoked from a configured
// deployment directory. Notification benchmarks use in-memory mock responses.
const directory = mkdtempSync(join(tmpdir(), "rubidium-benchmark-"));
process.env.RUBIDIUM_DATA_DIR = directory;
process.env.RUBIDIUM_DISABLE_SCHEDULER = "1";
const fixture = { tasks: 100, channels: 100, history: 100_000, pending: 10_000 };
const results = {};

async function measure(name, operation, samples = 20) {
  for (let index = 0; index < 3; index += 1) await operation();
  const times = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await operation();
    times.push(performance.now() - started);
  }
  times.sort((left, right) => left - right);
  results[name] = {
    samples,
    medianMs: Number(times[Math.floor(times.length / 2)].toFixed(3)),
    p95Ms: Number(times[Math.ceil(times.length * 0.95) - 1].toFixed(3)),
  };
}

try {
  const db = await import("../lib/db.ts");
  const scheduler = await import("../lib/scheduler.ts");
  const { previewSchedule, upcomingWeekDetails } = await import("../lib/cron.ts");
  const { taskFields } = await import("../lib/contracts.ts");
  const { sendBark } = await import("../lib/bark.ts");
  const { sendNtfy } = await import("../lib/ntfy.ts");
  const raw = db.__rawDatabaseForTests();
  const channels = Array.from({ length: fixture.channels }, (_, index) => db.saveChannel({
    name: `Benchmark channel ${index}`, type: "bark", endpoint: `https://channel-${index}.example`,
    credential: `benchmark-key-${index}`,
  }));
  const input = {
    name: "Benchmark reminder", description: "A synthetic reminder", startsAt: "2030-01-01T00:01:00.000Z",
    preset: "custom", cron: "* * * * *", repeatCount: null,
  };
  const tasks = Array.from({ length: fixture.tasks }, (_, index) => db.createTask({
    ...input, name: `Benchmark task ${index}`, deviceId: channels[index % channels.length].id,
  }, new Date("2030-01-01T00:00:00.000Z")));
  const seed = raw.prepare(`WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM numbers WHERE value < ?),
    task_ids AS (SELECT CAST(key AS INTEGER) position, value id FROM json_each(?))
    INSERT INTO deliveries (id, task_id, occurrence_at, status, attempts, next_attempt_at, created_at, delivered_at,
      title, body, activity_at, device_id, notification)
    SELECT ? || value, tasks.id, strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || value || ' minutes'), ?, ?,
      '2030-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z', ?, tasks.name, tasks.description,
      '2029-01-01T00:00:00.000Z', tasks.device_id, '{}' FROM numbers
    JOIN task_ids ON task_ids.position = (numbers.value - 1) % ? JOIN tasks ON tasks.id = task_ids.id`);
  db.transaction(() => {
    const ids = JSON.stringify(tasks.map((task) => task.id));
    seed.run(fixture.history, ids, "history-", "2028-01-01", "sent", 1, "2029-01-01T00:00:00.000Z", fixture.tasks);
    seed.run(fixture.pending, ids, "pending-", "2029-01-01", "pending", 0, null, fixture.tasks);
    raw.prepare("UPDATE tasks SET queued_count = ?, sent_count = ?")
      .run((fixture.history + fixture.pending) / fixture.tasks, fixture.history / fixture.tasks);
  });
  raw.exec("UPDATE deliveries SET attempts = 1 WHERE status = 'pending' AND rowid % 4 = 0");

  const now = new Date("2030-01-03T00:00:00.000Z");
  const capacityQuery = `SELECT COUNT(*) total, COUNT(CASE WHEN task_id = ? THEN 1 END) taskTotal
    FROM deliveries WHERE status IN ('pending', 'sending')`;
  const capacity = raw.prepare(capacityQuery);
  const capacityPlan = raw.prepare(`EXPLAIN QUERY PLAN ${capacityQuery}`).all(tasks[0].id).map((row) => row.detail);
  const indexedCapacity = raw.prepare(`SELECT
    (SELECT COUNT(*) FROM deliveries WHERE status IN ('pending', 'sending')) total,
    (SELECT COUNT(*) FROM deliveries WHERE task_id = ? AND status IN ('pending', 'sending')) taskTotal`);
  const listingPlans = Object.fromEntries([
    ["all", ""], ["pending", "WHERE status = 'pending'"],
    ["retrying", "WHERE status IN ('pending', 'sending') AND attempts > 0"],
  ].map(([name, where]) => [name, raw.prepare(`EXPLAIN QUERY PLAN SELECT * FROM deliveries ${where}
    ORDER BY activity_at DESC, occurrence_at DESC, id LIMIT 50`).all().map((row) => row.detail)]));
  await measure("settingsRead", () => db.readSettings());
  await measure("channelList", () => db.listChannels());
  await measure("taskPage50", () => db.listTasksPaginated({ page: 1, pageSize: 50 }));
  await measure("deliveryPage50", () => db.listDeliveries({ page: 1, pageSize: 50 }));
  await measure("deliveryPendingPage50", () => db.listDeliveries({ page: 1, pageSize: 50, status: "pending" }));
  await measure("deliveryRetryingPage50", () => db.listDeliveries({ page: 1, pageSize: 50, status: "retrying" }));
  await measure("dashboardStats", () => db.dashboardStats(now));
  await measure("queueCapacity", () => capacity.get(tasks[0].id));
  await measure("indexedQueueCapacity", () => indexedCapacity.get(tasks[0].id));
  await measure("dueTaskSelection", () => db.dueTaskRows(now));
  await measure("schedulePreview", () => previewSchedule(input, new Date("2029-12-31T00:00:00.000Z")));
  await measure("weekForecast100Tasks", () => upcomingWeekDetails(db.activeScheduleTasks(), now));
  await measure("taskValidation", () => taskFields.parse(input));
  await measure("queueBatch25", () => assert.ok(db.queueTaskBatch(tasks[0].id, now, 25) > 0));
  await measure("claimDelivery", () => assert.ok(db.claimDelivery(now)));
  await measure("processOneDelivery", async () => assert.ok(await scheduler.processOneDelivery(now, async () => {})));
  const settings = { ...db.deliverySettings("default"), deviceKey: "benchmark-key" };
  await measure("barkMockSend", () => sendBark(settings, "Benchmark", "Message", async () => Response.json({ code: 200 })));
  await measure("ntfyMockSend", () => sendNtfy({ ...settings, channelType: "ntfy", topic: "benchmark" }, "Benchmark", "Message", async () => Response.json({ id: "benchmark", event: "message", topic: "benchmark" })));
  console.log(JSON.stringify({
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    node: process.version, fixture, results, capacityPlan, listingPlans,
    note: "Local synthetic warm-cache timings; mock notification requests exclude real network latency.",
  }, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
