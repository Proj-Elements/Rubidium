import assert from "node:assert/strict";
import { backup, DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { logError } from "../lib/logging";

const directory = mkdtempSync(join(tmpdir(), "rubidium-transfer-"));
const snapshotPath = join(directory, "snapshot.sqlite");
process.env.BARKER_DATA_DIR = join(directory, "data");
delete process.env.BARKER_PASSWORD;
process.env.BARKER_SETUP_TOKEN = "";
process.env.BARKER_ALLOW_SETUP = "";

let database: typeof import("../lib/db");
let core: typeof import("../lib/db/core");
let transfer: typeof import("../lib/data-transfer");
let snapshotTaskId = "";

before(async () => {
  database = await import("../lib/db");
  core = await import("../lib/db/core");
  transfer = await import("../lib/data-transfer");
  database.initializeDatabase();
  database.saveChannel({ name: "Snapshot Ntfy", type: "ntfy", endpoint: "https://ntfy.example", topic: "snapshot", credential: "imported-channel-credential-2035" });
  const task = database.createTask({ name: "导出提醒", startsAt: "2035-01-01T09:00:00+00:00", preset: "once", cron: "0 9 * * *", repeatCount: 1, endDate: null, timeZone: "UTC" }, new Date("2030-01-01T00:00:00Z"));
  snapshotTaskId = task.id;
  core.statement("INSERT INTO settings (key, value) VALUES ('password_override', 'snapshot-password-hash')").run();
  core.statement("INSERT INTO settings (key, value) VALUES ('password_revision', '5')").run();
  core.statement("INSERT INTO sessions VALUES ('snapshot-session', ?, 'snapshot-fingerprint')").run(Date.now() + 86_400_000);
  core.statement("INSERT INTO api_tokens VALUES ('snapshot-token', 'old api', 'snapshot-digest', 'read', ?, ?)").run(Date.now() + 86_400_000, Date.now());
  await backup(core.connection(), snapshotPath);
});

after(() => {
  core?.connection().close();
  rmSync(directory, { recursive: true, force: true });
});

test("encrypted exports use authenticated encryption and reject wrong passwords or tampering", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(snapshotPath));
  const passphrase = "private-export-password-2035";
  const encrypted = transfer.encryptExport(source, passphrase);
  assert.notEqual(encrypted.payload, source.toString("base64"));
  assert.deepEqual(transfer.decryptExport(encrypted, passphrase), source);
  assert.throws(() => transfer.decryptExport(encrypted, "incorrect-export-password-2035"), /密码错误或导出文件损坏/);
  assert.throws(() => transfer.encryptExport(source, "short"), /12–200/);
  assert.throws(() => transfer.decryptExport({ ...encrypted, payload: `${encrypted.payload.slice(0, -4)}AAAA` }, passphrase), /密码错误或导出文件损坏/);
  assert.throws(() => transfer.decryptExport({ ...encrypted, schemaVersion: 99 }, passphrase), /不兼容/);
});

test("validated imports replace task data atomically and refresh active channel log secrets", async (context) => {
  const messages: string[] = [];
  context.mock.method(console, "error", (message: string) => messages.push(message));
  const activeSecret = "current-channel-credential-2035";
  database.saveChannel({ name: "Current Ntfy", type: "ntfy", endpoint: "https://ntfy.example", topic: "current", credential: activeSecret });
  const currentSession = "current-session";
  const currentToken = "current-token";
  core.statement("DELETE FROM sessions").run();
  core.statement("DELETE FROM api_tokens").run();
  core.statement("UPDATE settings SET value = 'current-password-hash' WHERE key = 'password_override'").run();
  core.statement("UPDATE settings SET value = '9' WHERE key = 'password_revision'").run();
  core.statement("INSERT INTO sessions VALUES (?, ?, 'current-fingerprint')").run(currentSession, Date.now() + 86_400_000);
  core.statement("INSERT INTO api_tokens VALUES (?, 'current api', 'current-digest', 'read', ?, ?)").run(currentToken, Date.now() + 86_400_000, Date.now());
  core.statement("DELETE FROM tasks WHERE id = ?").run(snapshotTaskId);
  database.createTask({ name: "仅当前数据", startsAt: "2035-02-01T09:00:00+00:00", preset: "once", cron: "0 9 * * *", repeatCount: 1, endDate: null, timeZone: "UTC" }, new Date("2030-01-01T00:00:00Z"));

  transfer.importDatabaseSnapshot(snapshotPath);

  logError("test.imported-channel-secret", new Error(`active=${activeSecret}; imported=imported-channel-credential-2035`));
  const log = messages.pop() ?? "";
  assert.match(log, new RegExp(activeSecret));
  assert.doesNotMatch(log, /imported-channel-credential-2035/);

  assert.deepEqual(database.listTasks().map((task) => task.name), ["导出提醒"]);
  assert.equal(core.statement("SELECT value FROM settings WHERE key = 'password_override'").get()?.value, "current-password-hash");
  assert.equal(core.statement("SELECT value FROM settings WHERE key = 'password_revision'").get()?.value, "9");
  assert.deepEqual(core.statement("SELECT id FROM sessions").all().map((row) => (row as { id: string }).id), [currentSession]);
  assert.deepEqual(core.statement("SELECT id FROM api_tokens").all().map((row) => (row as { id: string }).id), [currentToken]);
  assert.equal(database.listAuditEvents()[0]?.action, "data.import");

  const invalidPath = join(directory, "invalid.sqlite");
  const invalid = new DatabaseSync(invalidPath);
  invalid.exec("PRAGMA user_version=99");
  invalid.close();
  assert.throws(() => transfer.importDatabaseSnapshot(invalidPath), /不兼容/);

  const invalidStatusPath = join(directory, "invalid-status.sqlite");
  await backup(core.connection(), invalidStatusPath);
  const invalidStatus = new DatabaseSync(invalidStatusPath);
  invalidStatus.prepare("UPDATE tasks SET status = 'unexpected'").run();
  invalidStatus.close();
  assert.throws(() => transfer.importDatabaseSnapshot(invalidStatusPath), /提醒数据无效/);

  const invalidSchemaPath = join(directory, "invalid-schema.sqlite");
  await backup(core.connection(), invalidSchemaPath);
  const invalidSchema = new DatabaseSync(invalidSchemaPath);
  invalidSchema.exec("CREATE INDEX untrusted_index ON tasks(name)");
  invalidSchema.close();
  assert.throws(() => transfer.importDatabaseSnapshot(invalidSchemaPath), /结构与当前 Rubidium 不兼容/);
  assert.deepEqual(database.listTasks().map((task) => task.name), ["导出提醒"]);
});

test("export and import API require a browser session and restore only after authenticated decryption", async () => {
  process.env.BARKER_PASSWORD = "data-transfer-api-password-2035";
  core.statement("UPDATE settings SET value = ? WHERE key = 'password_override'").run(JSON.stringify({ source: "setup", salt: "current-salt", hash: "a".repeat(64) }));
  const auth = await import("../lib/auth");
  const exportRoute = await import("../app/api/data/export/route");
  const importRoute = await import("../app/api/data/import/route");
  const request = (path: string, body: unknown, session = true) => new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json",
      ...(session ? { cookie: `barker_session=${auth.createSessionToken()}` } : {}),
    },
    body: JSON.stringify(body),
  });

  assert.equal((await exportRoute.POST(request("/api/data/export", { passphrase: "private-export-password-2035" }, false))).status, 401);
  const exported = await exportRoute.POST(request("/api/data/export", { passphrase: "private-export-password-2035" }));
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("cache-control"), "no-store");
  const envelope = await exported.json();
  assert.equal(envelope.format, "rubidium-encrypted-export");
  const decrypted = transfer.decryptExport(envelope, "private-export-password-2035");
  const exportPath = join(directory, "api-export.sqlite");
  writeFileSync(exportPath, decrypted);
  const exportedDatabase = new DatabaseSync(exportPath, { readOnly: true });
  assert.equal(exportedDatabase.prepare("SELECT COUNT(*) count FROM sessions").get()?.count, 0);
  assert.equal(exportedDatabase.prepare("SELECT COUNT(*) count FROM api_tokens").get()?.count, 0);
  assert.equal(exportedDatabase.prepare("SELECT COUNT(*) count FROM settings WHERE key IN ('password_override', 'password_revision')").get()?.count, 0);
  exportedDatabase.close();

  database.createTask({ name: "错误密码后应保留", startsAt: "2035-03-01T09:00:00+00:00", preset: "once", cron: "0 9 * * *", repeatCount: 1, endDate: null, timeZone: "UTC" }, new Date("2030-01-01T00:00:00Z"));
  const wrongPassword = await importRoute.POST(request("/api/data/import", { passphrase: "incorrect-export-password-2035", envelope }));
  assert.equal(wrongPassword.status, 400);
  assert.ok(database.listTasks().some((task) => task.name === "错误密码后应保留"));

  const imported = await importRoute.POST(request("/api/data/import", { passphrase: "private-export-password-2035", envelope }));
  assert.equal(imported.status, 200);
  assert.ok(database.listTasks().some((task) => task.name === "导出提醒"));
  assert.equal(database.listTasks().some((task) => task.name === "错误密码后应保留"), false);
});
