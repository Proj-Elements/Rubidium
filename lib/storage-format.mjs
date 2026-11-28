import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATABASE_FILENAME = "rubidium.sqlite";
export const CURRENT_SCHEMA_VERSION = 6;
export const TRANSFER_VERSION = 2;

/** Return whether a database is empty; reject v1 and unknown schemas without migrating. */
export function databaseNeedsInitialization(database) {
  const version = database.prepare("PRAGMA user_version").get().user_version;
  if (version === CURRENT_SCHEMA_VERSION) return false;
  if (version === 0 && !database.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) return true;
  throw new Error(`Unsupported database schema ${version}; Rubidium v2 requires schema ${CURRENT_SCHEMA_VERSION} and a fresh v2 data directory. v1 migration is not supported.`);
}

/** Check compatibility before creating files, changing permissions or opening a writable database. */
export function assertV2DataDirectory(directory) {
  if (["barker.sqlite", "barker.sqlite-wal", "barker.sqlite-shm", "access-password.txt"].some((name) => existsSync(join(directory, name)))) {
    throw new Error("Rubidium v1 data detected. Use a new data directory for v2; v1 migration is not supported. Keep the v1 directory unchanged.");
  }
  const path = join(directory, DATABASE_FILENAME);
  if (!existsSync(path)) return;
  const database = new DatabaseSync(path, { readOnly: true });
  try { database.exec("PRAGMA busy_timeout=2000"); databaseNeedsInitialization(database); }
  finally { database.close(); }
}
