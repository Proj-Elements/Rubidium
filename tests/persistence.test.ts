import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function run(directory: string, code: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    cwd: process.cwd(), env: { ...process.env, RUBIDIUM_DATA_DIR: directory }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test("failed immutable outbox survives process restart and is subsequently delivered", () => {
  const directory = mkdtempSync(join(tmpdir(), "barker-restart-"));
  try {
    const first = run(directory, `
      const db = await import('./lib/db.ts');
      const scheduler = await import('./lib/scheduler.ts');
      const task = db.createTask({ name:'Persistent', description:'Original', startsAt:'2030-11-01T01:00:00Z', preset:'daily', cron:'0 9 * * *', repeatCount:1 }, new Date('2030-10-31T00:00:00Z'));
      await scheduler.enqueueDueOccurrences(new Date('2030-11-01T01:00:00Z'));
      await scheduler.processOneDelivery(new Date('2030-11-01T01:00:00Z'), async () => { throw new Error('offline'); });
      console.log(JSON.stringify({ id: task.id, pending: db.deliverySummary().pending }));
    `);
    assert.equal(first.pending, 1);
    const second = run(directory, `
      const db = await import('./lib/db.ts');
      const scheduler = await import('./lib/scheduler.ts');
      await scheduler.processOneDelivery(new Date('2030-11-01T02:00:00Z'), async (_, title, body) => { if(title !== 'Persistent' || body !== 'Original') throw new Error('payload changed'); });
      console.log(JSON.stringify({ pending: db.deliverySummary().pending, item: db.listDeliveries({ page:1, pageSize:10 }).deliveries[0] }));
    `);
    assert.equal(second.pending, 0);
    assert.equal((second.item as { status: string }).status, "sent");
    assert.equal((second.item as { attempts: number }).attempts, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("v2 rejects v1 database files and schemas without modifying their directory", () => {
  for (const name of ["barker.sqlite", "rubidium.sqlite"]) {
    for (const version of [0, 1, 2, 3, 4, 5]) {
      const directory = mkdtempSync(join(tmpdir(), "rubidium-v1-rejection-"));
      try {
        const path = join(directory, name);
        const database = new DatabaseSync(path);
        database.exec(`CREATE TABLE v1_data(value TEXT); INSERT INTO v1_data VALUES ('preserve me'); PRAGMA user_version=${version}`);
        database.close();
        const original = readFileSync(path);
        const mode = statSync(directory).mode;
        const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", "import('./lib/auth.ts').then(m => m.initializeAuth())"], {
          cwd: process.cwd(), env: { ...process.env, RUBIDIUM_DATA_DIR: directory }, encoding: "utf8",
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /v1 migration is not supported/);
        assert.deepEqual(readFileSync(path), original);
        assert.deepEqual(readdirSync(directory), [name]);
        assert.equal(statSync(directory).mode, mode);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
});

test("v2 creates its final schema once and retains channel and preference revisions on restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "rubidium-v2-restart-"));
  try {
    const initial = run(directory, `
      const db = await import('./lib/db.ts');
      const channel = db.saveChannel({ ...db.listChannels()[0], credential: 'v2-channel-secret' });
      const revision = db.writeSettings({ ...db.readSettings(), group: 'Personal' });
      console.log(JSON.stringify({ channel, revision, schema: db.__rawDatabaseForTests().prepare('SELECT sql FROM sqlite_schema ORDER BY name').all() }));
    `);
    const reopened = run(directory, `
      const db = await import('./lib/db.ts');
      console.log(JSON.stringify({ channel: db.listChannels()[0], revision: db.settingsRevision(), schema: db.__rawDatabaseForTests().prepare('SELECT sql FROM sqlite_schema ORDER BY name').all() }));
    `);
    assert.deepEqual(reopened, initial);
    assert.equal(existsSync(join(directory, "barker.sqlite")), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
