import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertV2DataDirectory } from "../lib/storage-format.mjs";
import { resolveRuntimeDataDirectory } from "../lib/environment.mjs";

export { resolveRuntimeDataDirectory as runtimeDirectory };

/** Resolve before Next's standalone entry changes cwd. Shell settings win. */
export function loadRuntimeEnvironment(directory = process.cwd()) {
  for (const name of [".env.production.local", ".env.local", ".env.production", ".env"]) {
    const file = resolve(directory, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function checkLegacyData(directory = process.cwd()) {
  loadRuntimeEnvironment(directory);
  assertV2DataDirectory(resolveRuntimeDataDirectory(directory));
  const legacy = resolve(directory, ".next/standalone/data/barker.sqlite");
  if (existsSync(legacy)) {
    throw new Error(`Rubidium v1 runtime data found at ${legacy}. Keep it outside .next and use a fresh v2 data directory; v1 migration is not supported.`);
  }
}
