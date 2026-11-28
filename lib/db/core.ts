import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, DATABASE_FILENAME, databaseNeedsInitialization } from "../storage-format.mjs";
import { DEFAULT_SETTINGS } from "../types";
import { initializeStorage, privateFile, runtimeDataDir } from "../storage";

const globalDb = globalThis as typeof globalThis & { rubidiumDb?: DatabaseSync };
const databaseFile = Buffer.from(`${runtimeDataDir}/${DATABASE_FILENAME}`);
const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
const retryWait = new Int32Array(new SharedArrayBuffer(4));
export { CURRENT_SCHEMA_VERSION } from "../storage-format.mjs";
const INITIALIZATION_ATTEMPTS = 3;
let db: DatabaseSync;
let initialized = false;

export function transaction<T>(callback: () => T): T {
  initializeDatabase();
  const nested = db.isTransaction;
  db.exec(nested ? "SAVEPOINT rubidium_nested" : "BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec(nested ? "RELEASE rubidium_nested" : "COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec(nested ? "ROLLBACK TO rubidium_nested; RELEASE rubidium_nested" : "ROLLBACK");
    throw error;
  }
}

function createSchema(): void {
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL, preset TEXT NOT NULL, cron TEXT NOT NULL,
      repeat_count INTEGER, end_date TEXT, sent_count INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT, last_run_at TEXT, last_error TEXT,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      queued_count INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
      time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai', max_lateness_minutes INTEGER, paused_at TEXT, resume_at TEXT,
      last_queued_at TEXT, device_id TEXT NOT NULL DEFAULT 'default', notification TEXT NOT NULL DEFAULT '{}',
      skip_dates TEXT NOT NULL DEFAULT '[]', include_dates TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE deliveries (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), occurrence_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL, lease_until TEXT, last_error TEXT,
      created_at TEXT NOT NULL, delivered_at TEXT, title TEXT, body TEXT, expires_at TEXT,
      manual_only INTEGER NOT NULL DEFAULT 0, device_id TEXT NOT NULL DEFAULT 'default',
      notification TEXT NOT NULL DEFAULT '{}', activity_at TEXT, UNIQUE(task_id, occurrence_at)
    );
    CREATE TABLE sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, fingerprint TEXT NOT NULL);
    CREATE TABLE api_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, scope TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
    CREATE TABLE runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL, device_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL DEFAULT 'bark', topic TEXT NOT NULL DEFAULT '');
    CREATE TABLE audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX audit_created_idx ON audit_events(created_at);
    CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE);
    CREATE TABLE delivery_attempts (
      id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
      lease_token TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT NOT NULL, error TEXT
    );
    CREATE INDEX attempts_delivery_idx ON delivery_attempts(delivery_id, started_at DESC);
  `);
  db.exec(`
    CREATE INDEX tasks_due_idx ON tasks(status, next_run_at);
    CREATE INDEX tasks_pause_idx ON tasks(paused_at, next_run_at);
    CREATE INDEX deliveries_pending_idx ON deliveries(status, next_attempt_at);
    CREATE INDEX deliveries_pending_occurrence_idx ON deliveries(status, manual_only, next_attempt_at, occurrence_at, created_at, id);
    CREATE INDEX deliveries_lease_idx ON deliveries(status, lease_until, id);
    CREATE INDEX deliveries_task_status_idx ON deliveries(task_id, status);
    CREATE INDEX deliveries_task_error_idx ON deliveries(task_id, activity_at DESC)
      WHERE status IN ('pending', 'sending') AND last_error IS NOT NULL;
    CREATE INDEX deliveries_activity_order_idx ON deliveries(activity_at DESC, occurrence_at DESC, id);
    CREATE INDEX deliveries_status_activity_idx ON deliveries(status, activity_at DESC, occurrence_at DESC, id);
    CREATE INDEX deliveries_sent_idx ON deliveries(status, delivered_at);
    CREATE INDEX deliveries_expiry_idx ON deliveries(status, expires_at);
    CREATE INDEX runtime_endpoint_cooldown_idx ON runtime_state(CAST(value AS INTEGER))
      WHERE key GLOB 'endpoint:*';
  `);
  const insert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  insert.run("default", JSON.stringify(DEFAULT_SETTINGS));
  insert.run("revision", "1");
  db.prepare("INSERT INTO devices (id, name, endpoint, device_key) VALUES ('default', '主要通知', 'https://api.day.app', '')").run();
  db.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION}`);
}

export function initializeDatabase(): void {
  if (initialized) return;
  initializeStorage();
  const shared = globalDb.rubidiumDb;
  db = shared ?? new DatabaseSync(databaseFile);
  try {
    db.exec("PRAGMA busy_timeout=2000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;");
    initialized = true;
    for (let attempt = 1; attempt <= INITIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        db.exec("PRAGMA journal_mode=WAL;");
        transaction(() => { if (databaseNeedsInitialization(db)) createSchema(); });
        break;
      } catch (error) {
        if (!(error instanceof Error) || !/database is locked|database schema is locked/i.test(error.message) || attempt === INITIALIZATION_ATTEMPTS) throw error;
        Atomics.wait(retryWait, 0, 0, 100);
      }
    }
    for (const suffix of ["", "-wal", "-shm"]) privateFile(`${databaseFile.toString()}${suffix}`);
    globalDb.rubidiumDb = db;
  } catch (error) {
    initialized = false;
    statements.clear();
    if (!shared) db.close();
    throw error;
  }
}

export function statement(sql: string) {
  initializeDatabase();
  let prepared = statements.get(sql);
  if (!prepared) { prepared = db.prepare(sql); statements.set(sql, prepared); }
  return prepared;
}

export function connection(): DatabaseSync { initializeDatabase(); return db; }
export function dataDirectory(): string { return runtimeDataDir; }
export function databasePath(): string { return databaseFile.toString(); }
