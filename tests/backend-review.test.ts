import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { DEFAULT_SETTINGS } from "../lib/types";

const directory = mkdtempSync(join(tmpdir(), "rubidium-backend-review-"));
process.env.RUBIDIUM_DATA_DIR = directory;
let db: typeof import("../lib/db");
let scheduler: typeof import("../lib/scheduler");
before(async () => { db = await import("../lib/db"); scheduler = await import("../lib/scheduler"); });
beforeEach(() => {
  db.__rawDatabaseForTests().exec("DELETE FROM deliveries; DELETE FROM tasks; DELETE FROM devices WHERE id <> 'default'; DELETE FROM runtime_state;");
  db.__rawDatabaseForTests().exec("UPDATE devices SET type = 'bark', endpoint = 'https://api.day.app', topic = '', device_key = '' WHERE id = 'default'");
  db.writeSettings(DEFAULT_SETTINGS);
});
after(() => rmSync(directory, { recursive: true, force: true }));

const due = new Date("2030-01-01T01:00:00.000Z");
function pendingDelivery(deviceId = "default") {
  const task = db.createTask({
    name: "Original", startsAt: due.toISOString(), preset: "once", cron: "0 9 * * *", repeatCount: 1, deviceId,
  }, new Date("2030-01-01T00:00:00.000Z"));
  db.queueTaskBatch(task.id, due);
  return db.listDeliveries({ page: 1, pageSize: 50 }).deliveries.find((delivery) => delivery.taskId === task.id)!;
}

test("delivery edits in one clock tick reject stale content", () => {
  const original = pendingDelivery();
  db.editDelivery(original.id, "First edit", "", original.updatedAt, due);
  assert.throws(() => db.editDelivery(original.id, "Stale edit", "", original.updatedAt, due), { status: 409 });
  assert.equal(db.listDeliveries({ page: 1, pageSize: 1 }).deliveries[0].taskName, "First edit");
});

test("manual retry invalidates an earlier delivery edit snapshot in the same tick", () => {
  const original = pendingDelivery();
  assert.equal(db.retryDeliveryResult(original.id, due), "queued");
  assert.throws(() => db.editDelivery(original.id, "Stale edit", "", original.updatedAt, due), { status: 409 });
});

test("a failed send invalidates the pre-claim edit snapshot in the same tick", () => {
  const original = pendingDelivery();
  const claim = db.claimDelivery(due)!;
  db.markDeliveryFailed(claim.id, claim.leaseUntil, 1, "offline", due);
  assert.throws(() => db.editDelivery(original.id, "Stale edit", "", original.updatedAt, due), { status: 409 });
});

test("delivery revision timestamps advance when the wall clock moves backwards", () => {
  const original = pendingDelivery();
  const earlier = new Date(due.getTime() - 1000);
  db.editDelivery(original.id, "First edit", "", original.updatedAt, earlier);
  const edited = db.listDeliveries({ page: 1, pageSize: 1 }).deliveries[0];
  assert.ok(edited.updatedAt > original.updatedAt);
  db.editDelivery(original.id, "Second edit", "", edited.updatedAt, earlier);
  assert.throws(() => db.editDelivery(original.id, "Stale edit", "", original.updatedAt, earlier), { status: 409 });
});

test("delivery pages retain deterministic ordering when activity and occurrence timestamps tie", () => {
  const taskIds = [pendingDelivery().taskId, pendingDelivery().taskId];
  const raw = db.__rawDatabaseForTests();
  raw.exec("DELETE FROM deliveries");
  const insert = raw.prepare(`INSERT INTO deliveries
    (id, task_id, occurrence_at, status, attempts, next_attempt_at, created_at, activity_at, title, body)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'Tied timestamp', '')`);
  const rows = Array.from({ length: 60 }, (_, index) => ({
    id: `tied-${String(index).padStart(2, "0")}`,
    occurrenceAt: new Date(due.getTime() + Math.floor(index / 2) * 60_000).toISOString(),
    status: index % 2 ? "sent" : "pending",
  }));
  db.transaction(() => rows.forEach((row, index) => insert.run(
    row.id, taskIds[index % 2], row.occurrenceAt, row.status, due.toISOString(), due.toISOString(), due.toISOString(),
  )));
  rows.sort((left, right) => right.occurrenceAt.localeCompare(left.occurrenceAt) || left.id.localeCompare(right.id));
  for (const status of [undefined, "pending", "retrying"] as const) {
    const expected = rows.filter((row) => !status || row.status === "pending").map((row) => row.id);
    const actual = [1, 2].flatMap((page) => db.listDeliveries({ page, pageSize: 7, status }).deliveries.map((row) => row.id));
    assert.deepEqual(actual, expected.slice(0, 14));
  }
});

test("live cooldown selection shares Bark identities, distinguishes Ntfy topics and observes credential rotation", async () => {
  const endpoint = "https://shared.example";
  const credential = "shared-benchmark-credential";
  db.saveChannel({ ...db.listChannels()[0], endpoint, credential });
  let mirror = db.saveChannel({ name: "Mirror", type: "bark", endpoint, credential });
  const ntfyA = db.saveChannel({ name: "Ntfy A", type: "ntfy", endpoint, credential, topic: "a" });
  const ntfyB = db.saveChannel({ name: "Ntfy B", type: "ntfy", endpoint, credential, topic: "b" });
  const items = [pendingDelivery(), pendingDelivery(mirror.id), pendingDelivery(ntfyA.id), pendingDelivery(ntfyB.id)];
  for (const id of ["default", ntfyA.id]) {
    db.extendEndpointCooldown(db.endpointStateKey(db.deliverySettings(id)), due.getTime() + 60_000);
  }
  assert.equal(await scheduler.processOneDelivery(due, async (settings) => {
    assert.equal(settings.channelType, "ntfy");
    assert.equal(settings.topic, "b");
  }), true);
  assert.equal(await scheduler.processOneDelivery(due, async () => assert.fail("cooling endpoints must not send")), false);
  mirror = db.saveChannel({ ...mirror, credential: "rotated-credential", revision: mirror.revision });
  assert.equal(await scheduler.processOneDelivery(due, async (settings) => {
    assert.equal(settings.deviceKey, "rotated-credential");
  }), true);
  const deliveries = db.listDeliveries({ page: 1, pageSize: 50 }).deliveries;
  assert.deepEqual(items.map((item) => deliveries.find((delivery) => delivery.id === item.id)?.status), ["pending", "sent", "pending", "sent"]);
});

test("queued notification options cannot override live channel settings", async () => {
  const channel = db.saveChannel({
    name: "Protected channel", type: "ntfy", endpoint: "https://trusted.example", credential: "live-channel-credential", topic: "trusted_topic",
  });
  const original = pendingDelivery(channel.id);
  const options = {
    sound: "", group: "Task group", icon: "https://icons.example/reminder.png",
    endpoint: "https://untrusted.example", deviceKey: "substituted-credential", title: "Overridden title",
    channelType: "bark", topic: "substituted_topic", historyRetentionDays: 1,
  };
  db.__rawDatabaseForTests().prepare("UPDATE deliveries SET notification = ? WHERE id = ?")
    .run(JSON.stringify(options), original.id);
  assert.equal(await scheduler.processOneDelivery(due, async (settings) => {
    assert.deepEqual(settings, {
      ...DEFAULT_SETTINGS, endpoint: channel.endpoint, deviceKey: "live-channel-credential", channelType: "ntfy", topic: "trusted_topic",
      sound: "", group: "Task group", icon: "https://icons.example/reminder.png",
    });
  }), true);
  assert.equal(db.listDeliveries({ page: 1, pageSize: 1 }).deliveries[0].status, "sent");
});

for (const notification of ["{invalid-json", JSON.stringify({ sound: 42, deviceKey: "untrusted-stored-secret" })]) {
  test(`invalid queued notification options release the claim and require repair: ${notification}`, async () => {
    const original = pendingDelivery();
    const raw = db.__rawDatabaseForTests();
    raw.prepare("UPDATE deliveries SET notification = ? WHERE id = ?").run(notification, original.id);

    assert.equal(await scheduler.processOneDelivery(due, async () => assert.fail("invalid options must not send")), true);
    const failed = db.listDeliveries({ page: 1, pageSize: 1 }).deliveries[0];
    assert.equal(failed.status, "pending");
    assert.equal(failed.manualOnly, true);
    assert.equal(failed.attempts, 1);
    assert.equal(raw.prepare("SELECT lease_until FROM deliveries WHERE id = ?").get(original.id)?.lease_until, null);
    const [attempt] = db.deliveryAttempts(original.id);
    assert.equal(attempt.outcome, "failed");
    assert.ok(attempt.finishedAt);
    assert.equal(attempt.error, failed.lastError);
    assert.doesNotMatch(failed.lastError!, /untrusted-stored-secret|invalid-json/);

    const healthy = pendingDelivery();
    assert.equal(await scheduler.processOneDelivery(due, async () => {}), true);
    assert.equal(db.listDeliveries({ page: 1, pageSize: 50 }).deliveries.find((item) => item.id === healthy.id)?.status, "sent");
    assert.equal(await scheduler.processOneDelivery(new Date(due.getTime() + 180_000), async () => assert.fail("invalid options must wait for repair")), false);

    raw.prepare("UPDATE deliveries SET notification = '{}' WHERE id = ?").run(original.id);
    assert.equal(db.retryDeliveryResult(original.id, due), "queued");
    assert.equal(await scheduler.processOneDelivery(due, async () => {}), true);
    assert.equal(db.listDeliveries({ page: 1, pageSize: 50 }).deliveries.find((item) => item.id === original.id)?.status, "sent");
    assert.deepEqual(db.deliveryAttempts(original.id).map((item) => item.outcome).sort(), ["failed", "sent"]);
  });
}

test("configuration read failures preserve scheduler health reporting and recoverable leases", async (context) => {
  context.mock.method(console, "error", () => {});
  const original = pendingDelivery();
  const raw = db.__rawDatabaseForTests();
  raw.exec("ALTER TABLE devices RENAME COLUMN type TO unavailable_type");
  try {
    await scheduler.runSchedulerCycle(due, async () => assert.fail("unavailable configuration must not send"));
    assert.equal(db.readRuntimeState("scheduler_error"), "cycle_failed");
    assert.equal(scheduler.schedulerHealth(), false);
    const row = raw.prepare("SELECT status, attempts, manual_only, lease_until, last_error FROM deliveries WHERE id = ?").get(original.id)!;
    assert.equal(row.status, "sending");
    assert.equal(row.attempts, 0);
    assert.equal(row.manual_only, 0);
    assert.equal(row.lease_until, new Date(due.getTime() + 120_000).toISOString());
    assert.equal(row.last_error, null);
  } finally {
    raw.exec("ALTER TABLE devices RENAME COLUMN unavailable_type TO type");
  }
  const recoveredAt = new Date(due.getTime() + 121_000);
  assert.equal(await scheduler.processOneDelivery(recoveredAt, async () => {}), true);
  assert.deepEqual(db.deliveryAttempts(original.id).map((attempt) => attempt.outcome), ["sent", "interrupted"]);
  assert.equal(db.listDeliveries({ page: 1, pageSize: 1 }).deliveries[0].attempts, 2);
  await scheduler.runSchedulerCycle(recoveredAt, async () => {});
  assert.equal(db.readRuntimeState("scheduler_error"), "");
  assert.equal(scheduler.schedulerHealth(), true);
});

test("failed persistence of invalid configuration preserves lease recovery", async (context) => {
  context.mock.method(console, "error", () => {});
  const original = pendingDelivery();
  const raw = db.__rawDatabaseForTests();
  raw.prepare("UPDATE deliveries SET notification = ? WHERE id = ?").run('{"sound":42}', original.id);
  raw.exec("CREATE TRIGGER reject_delivery_failure BEFORE UPDATE OF status ON deliveries WHEN NEW.status = 'pending' BEGIN SELECT RAISE(ABORT, 'failure persistence unavailable'); END;");
  try {
    await assert.rejects(scheduler.processOneDelivery(due, async () => assert.fail("invalid configuration must not send")), /failure persistence unavailable/);
    const row = raw.prepare("SELECT status, attempts, manual_only, lease_until, last_error FROM deliveries WHERE id = ?").get(original.id)!;
    assert.equal(row.status, "sending");
    assert.equal(row.attempts, 0);
    assert.equal(row.manual_only, 0);
    assert.equal(row.lease_until, new Date(due.getTime() + 120_000).toISOString());
    assert.equal(row.last_error, null);
    assert.equal(db.deliveryAttempts(original.id)[0].outcome, "sending");
  } finally {
    raw.exec("DROP TRIGGER reject_delivery_failure");
  }
  assert.equal(await scheduler.processOneDelivery(new Date(due.getTime() + 121_000), async () => assert.fail("invalid configuration must not send")), true);
  const failed = db.listDeliveries({ page: 1, pageSize: 1 }).deliveries[0];
  assert.equal(failed.status, "pending");
  assert.equal(failed.attempts, 2);
  assert.equal(failed.manualOnly, true);
  assert.deepEqual(db.deliveryAttempts(original.id).map((attempt) => attempt.outcome), ["failed", "interrupted"]);
});
