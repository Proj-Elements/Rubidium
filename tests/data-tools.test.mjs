import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CURRENT_SCHEMA_VERSION } from "../lib/db/core.ts";
import { backupData, MAX_SUPPORTED_SCHEMA_VERSION, restoreData } from "../scripts/data-tools.mjs";

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "barker-data-tools-"));
  const source = join(root, "source");
  mkdirSync(source);
  const database = new DatabaseSync(join(source, "barker.sqlite"));
  database.exec(`
    PRAGMA user_version = 4;
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY);
    CREATE TABLE deliveries (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id));
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('default', '{}');
    INSERT INTO tasks VALUES ('task');
    INSERT INTO deliveries VALUES ('delivery', 'task');
    INSERT INTO sessions VALUES ('session');
    INSERT INTO runtime_state VALUES ('scheduler_heartbeat', '1');
  `);
  database.close();
  writeFileSync(join(source, "access-password.txt"), "test-data-tools-password", { mode: 0o644 });
  writeFileSync(join(source, "session-secret.txt"), "test-data-tools-session-secret", { mode: 0o644 });
  return { root, source };
}

test("backup tooling tracks and round-trips the current application schema", async () => {
  assert.equal(MAX_SUPPORTED_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  const { root, source } = fixture();
  const backup = join(root, "backup");
  const restored = join(root, "restored");
  const sourceDatabase = new DatabaseSync(join(source, "barker.sqlite"));
  sourceDatabase.exec(`
    PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};
    CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL, device_key TEXT NOT NULL, revision INTEGER NOT NULL, type TEXT NOT NULL, topic TEXT NOT NULL);
    ALTER TABLE tasks ADD COLUMN device_id TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE deliveries ADD COLUMN device_id TEXT NOT NULL DEFAULT 'default';
    INSERT INTO devices VALUES ('ntfy-id', 'Ntfy', 'https://ntfy.sh', 'secret-token', 1, 'ntfy', 'rubidium');
  `);
  sourceDatabase.close();

  try {
    const result = await backupData(source, backup);
    assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);
    await restoreData(backup, restored);
    const restoredDatabase = new DatabaseSync(join(restored, "barker.sqlite"), { readOnly: true });
    try {
      assert.equal(restoredDatabase.prepare("PRAGMA user_version").get().user_version, CURRENT_SCHEMA_VERSION);
      const channel = restoredDatabase.prepare("SELECT type, topic FROM devices WHERE id = 'ntfy-id'").get();
      assert.equal(channel.type, "ntfy");
      assert.equal(channel.topic, "rubidium");
    } finally { restoredDatabase.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI backs up and restores a real current application database", () => {
  const root = mkdtempSync(join(tmpdir(), "rubidium-current-backup-"));
  const source = join(root, "source");
  const backup = join(root, "backup");
  const restored = join(root, "restored");
  const setupCode = `
    import { CURRENT_SCHEMA_VERSION, initializeDatabase } from "./lib/db/core.ts";
    import { createTask, saveChannel } from "./lib/db.ts";
    initializeDatabase();
    const channel = saveChannel({ name: "Backup channel", type: "ntfy", endpoint: "https://ntfy.sh", topic: "backup", credential: "test-backup-token" });
    const task = createTask({ name: "Backup task", startsAt: "2035-01-01T09:00:00+08:00", timeZone: "Asia/Shanghai", preset: "daily", cron: "0 9 * * *", repeatCount: 2, deviceId: channel.id }, new Date("2034-01-01T00:00:00Z"));
    console.log(JSON.stringify({ version: CURRENT_SCHEMA_VERSION, taskId: task.id }));
  `;
  const environment = { ...process.env, BARKER_DATA_DIR: source };
  try {
    const setup = spawnSync(process.execPath, ["--import", "tsx", "--eval", setupCode], { cwd: process.cwd(), env: environment, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr);
    const initialized = JSON.parse(setup.stdout.trim());
    assert.equal(initialized.version, CURRENT_SCHEMA_VERSION);

    const backupResult = spawnSync(process.execPath, ["scripts/data-tools.mjs", "backup", backup, source], { cwd: process.cwd(), env: environment, encoding: "utf8" });
    assert.equal(backupResult.status, 0, backupResult.stderr);
    assert.equal(JSON.parse(backupResult.stdout).schemaVersion, CURRENT_SCHEMA_VERSION);
    const restoreResult = spawnSync(process.execPath, ["scripts/data-tools.mjs", "restore", restored, backup], { cwd: process.cwd(), env: environment, encoding: "utf8" });
    assert.equal(restoreResult.status, 0, restoreResult.stderr);
    assert.deepEqual(JSON.parse(restoreResult.stdout), { restored: true });

    const verifyCode = `
      import { DatabaseSync } from "node:sqlite";
      const database = new DatabaseSync(${JSON.stringify(join(restored, "barker.sqlite"))}, { readOnly: true });
      const version = database.prepare("PRAGMA user_version").get().user_version;
      const integrity = database.prepare("PRAGMA integrity_check").all();
      const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
      const reference = database.prepare("SELECT devices.type, devices.topic FROM tasks JOIN devices ON devices.id = tasks.device_id WHERE tasks.id = ?").get(${JSON.stringify(initialized.taskId)});
      if (version !== ${CURRENT_SCHEMA_VERSION} || integrity.length !== 1 || integrity[0].integrity_check !== "ok" || foreignKeys.length || reference?.type !== "ntfy" || reference?.topic !== "backup") process.exitCode = 1;
      database.close();
      console.log(JSON.stringify({ version, integrity: integrity[0]?.integrity_check, foreignKeyErrors: foreignKeys.length, channelType: reference?.type, topic: reference?.topic }));
    `;
    const verification = spawnSync(process.execPath, ["--input-type=module", "--eval", verifyCode], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(verification.status, 0, verification.stderr);
    assert.deepEqual(JSON.parse(verification.stdout.trim()), {
      version: CURRENT_SCHEMA_VERSION, integrity: "ok", foreignKeyErrors: 0, channelType: "ntfy", topic: "backup",
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("restore rejects a newer schema without changing the backup or leaving a target", async () => {
  const { root, source } = fixture();
  const backup = join(root, "backup");
  const target = join(root, "restored");
  try {
    await backupData(source, backup);
    const database = new DatabaseSync(join(backup, "barker.sqlite"));
    database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    database.close();
    const manifestPath = join(backup, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
    manifest.files["barker.sqlite"] = digest(join(backup, "barker.sqlite"));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const backupDigest = digest(join(backup, "barker.sqlite"));

    await assert.rejects(restoreData(backup, target), new RegExp(`Unsupported schema version ${CURRENT_SCHEMA_VERSION + 1}`));
    assert.equal(existsSync(target), false);
    assert.equal(digest(join(backup, "barker.sqlite")), backupDigest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("backup and restore are checksummed, private, and never overwrite data", async () => {
  const { root, source } = fixture();
  const backup = join(root, "backup");
  const restored = join(root, "restored");
  try {
    const result = await backupData(source, backup);
    assert.equal(result.schemaVersion, 4);
    assert.deepEqual(result.files, ["barker.sqlite", "access-password.txt", "session-secret.txt"]);
    assert.equal(statSync(backup).mode & 0o777, 0o700);
    for (const file of ["barker.sqlite", "access-password.txt", "session-secret.txt", "manifest.json"]) assert.equal(statSync(join(backup, file)).mode & 0o777, 0o600);
    await assert.rejects(backupData(source, backup), /already exists/);
    await restoreData(backup, restored);
    assert.equal(statSync(restored).mode & 0o777, 0o700);
    for (const file of ["barker.sqlite", "access-password.txt", "session-secret.txt", "manifest.json"]) assert.equal(statSync(join(restored, file)).mode & 0o777, 0o600);
    const manifest = JSON.parse(readFileSync(join(restored, "manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 4);
    for (const [name, checksum] of Object.entries(manifest.files)) assert.equal(checksum, digest(join(restored, name)));
    const database = new DatabaseSync(join(restored, "barker.sqlite"), { readOnly: true });
    assert.equal(database.prepare("SELECT COUNT(*) count FROM tasks").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM deliveries").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sessions").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM runtime_state").get().count, 0);
    database.close();
    await assert.rejects(restoreData(backup, restored), /new data directory/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("restore rejects tampered backup content", async () => {
  const { root, source } = fixture();
  const backup = join(root, "backup");
  try {
    await backupData(source, backup);
    writeFileSync(join(backup, "access-password.txt"), "tampered");
    await assert.rejects(restoreData(backup, join(root, "restored")), /checksum/);
    rmSync(join(root, "restored"), { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("restore rejects unexpected files in a valid backup", async () => {
  const { root, source } = fixture();
  const backup = join(root, "backup");
  const target = join(root, "restored");
  try {
    await backupData(source, backup);
    writeFileSync(join(backup, "unexpected.txt"), "extra");
    await assert.rejects(restoreData(backup, target), /unexpected files/);
    assert.equal(existsSync(target), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("backup and restore refuse targets nested inside their source", async () => {
  const { root, source } = fixture();
  const backup = join(root, "backup");
  try {
    await assert.rejects(backupData(source, join(source, "backup")), /outside the source/);
    await assert.rejects(backupData(source, join(source, "..cache")), /outside the source/);
    await backupData(source, backup);
    await assert.rejects(restoreData(backup, join(backup, "restored")), /outside the backup/);
    await assert.rejects(restoreData(backup, join(backup, "..cache")), /outside the backup/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("backup CLI refuses an existing target", () => {
  const { root, source } = fixture();
  const target = join(root, "backup");
  mkdirSync(target);
  try {
    const result = spawnSync(process.execPath, ["scripts/data-tools.mjs", "backup", target, source], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/);
    assert.equal(existsSync(join(target, "manifest.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a live WAL database produces a portable backup without sidecars", async () => {
  const { root, source } = fixture();
  const live = new DatabaseSync(join(source, "barker.sqlite"));
  try {
    live.exec("PRAGMA journal_mode=WAL; INSERT INTO tasks VALUES ('uncheckpointed');");
    assert.equal(existsSync(join(source, "barker.sqlite-wal")), true);
    await backupData(source, join(root, "snapshot"));
    for (const suffix of ["-wal", "-shm"]) assert.equal(existsSync(join(root, "snapshot", `barker.sqlite${suffix}`)), false);
    await restoreData(join(root, "snapshot"), join(root, "restore"));
    const restored = new DatabaseSync(join(root, "restore", "barker.sqlite"));
    assert.equal(restored.prepare("SELECT COUNT(*) count FROM tasks").get().count, 2);
    restored.close();
  } finally { live.close(); rmSync(root, { recursive: true, force: true }); }
});
