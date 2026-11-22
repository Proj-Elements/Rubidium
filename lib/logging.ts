import { redactSecrets } from "./errors";

const secretsBySource = new Map<string, string>();

export function setLogSecret(source: string, value: string | null | undefined): void {
  if (value) secretsBySource.set(source, value);
  else secretsBySource.delete(source);
}

export function replaceLogSecrets(prefix: string, entries: Iterable<readonly [string, string]>): void {
  for (const source of secretsBySource.keys()) {
    if (source.startsWith(prefix)) secretsBySource.delete(source);
  }
  for (const [source, value] of entries) {
    if (source.startsWith(prefix) && value) secretsBySource.set(source, value);
  }
}

export function __logSecretSourceCountForTests(prefix = ""): number {
  return [...secretsBySource.keys()].filter((source) => source.startsWith(prefix)).length;
}

export function logError(event: string, error: unknown, context: Record<string, string | number> = {}): void {
  const detail = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack, code: "code" in error ? error.code : undefined }
    : { message: String(error) };
  const secrets = [...new Set(secretsBySource.values())];
  console.error(redactSecrets(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event, ...context, ...detail }), secrets, 8192));
}
