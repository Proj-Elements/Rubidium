import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "rubidium-backend-review-"));
process.env.RUBIDIUM_DATA_DIR = directory;
let db: typeof import("../lib/db");
before(async () => { db = await import("../lib/db"); });
beforeEach(() => {
  db.__rawDatabaseForTests().exec("DELETE FROM deliveries; DELETE FROM tasks; DELETE FROM runtime_state;");
});
after(() => rmSync(directory, { recursive: true, force: true }));

const due = new Date("2030-01-01T01:00:00.000Z");
function pendingDelivery() {
  const task = db.createTask({
    name: "Original", startsAt: due.toISOString(), preset: "once", cron: "0 9 * * *", repeatCount: 1,
  }, new Date("2030-01-01T00:00:00.000Z"));
  db.queueTaskBatch(task.id, due);
  return db.listDeliveries({ page: 1, pageSize: 1 }).deliveries[0];
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
