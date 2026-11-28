import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getEnvironmentVariable, resolveRuntimeDataDirectory } from "./environment.mjs";
import { assertV2DataDirectory } from "./storage-format.mjs";

export const runtimeDataDir = resolve(/* turbopackIgnore: true */ getEnvironmentVariable("DATA_DIR") || "./data");

/** Filesystem changes happen at runtime initialization, never on import. */
export function initializeStorage(): void {
  resolveRuntimeDataDirectory(process.cwd(), runtimeDataDir);
  assertV2DataDirectory(runtimeDataDir);
  mkdirSync(runtimeDataDir, { recursive: true, mode: 0o700 });
  chmodSync(runtimeDataDir, 0o700);
}

export function privateFile(path: string): void {
  try { chmodSync(/* turbopackIgnore: true */ path, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
