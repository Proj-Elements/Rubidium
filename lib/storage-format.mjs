import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

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
  // A read-only SQLite open can create WAL/SHM files. Inspect the main file
  // immutably first, so rejecting an old WAL-mode database leaves no artifacts.
  const uri = pathToFileURL(path);
  uri.searchParams.set("immutable", "1");
  const database = new DatabaseSync(uri, { readOnly: true });
  let empty;
  try { empty = databaseNeedsInitialization(database); }
  finally { database.close(); }
  if (!empty || !existsSync(`${path}-wal`)) return;
  // During first startup the schema may still live only in WAL. Validate a
  // private copy in that rare case rather than modifying the source sidecars.
  const staging = mkdtempSync(join(tmpdir(), "rubidium-preflight-"));
  try {
    const copy = join(staging, DATABASE_FILENAME);
    copyFileSync(path, copy);
    try { copyFileSync(`${path}-wal`, `${copy}-wal`); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const snapshot = new DatabaseSync(copy, { readOnly: true });
    try { databaseNeedsInitialization(snapshot); }
    finally { snapshot.close(); }
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
