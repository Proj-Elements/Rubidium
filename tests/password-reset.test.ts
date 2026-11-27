import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "rubidium-password-reset-"));
process.env.RUBIDIUM_DATA_DIR = directory;
process.env.RUBIDIUM_SESSION_SECRET = "rubidium-password-reset-session";
delete process.env.RUBIDIUM_PASSWORD;
process.env.RUBIDIUM_SETUP_TOKEN = "";
process.env.RUBIDIUM_ALLOW_SETUP = "";

let auth: typeof import("../lib/auth");
let database: typeof import("../lib/db");
let resetPassword: typeof import("../scripts/password-reset.mjs").resetPassword;
before(async () => {
  auth = await import("../lib/auth");
  database = await import("../lib/db");
  ({ resetPassword } = await import("../scripts/password-reset.mjs"));
});
after(() => rmSync(directory, { recursive: true, force: true }));

function checkConfiguredCliReset(password: string, splitInput = false): void {
  const root = mkdtempSync(join(tmpdir(), "rubidium-reset-cli-config-"));
  const configured = join(root, "configured-data");
  const decoy = join(root, "data");
  for (const path of [configured, decoy]) {
    mkdirSync(path);
    const database = new DatabaseSync(join(path, "barker.sqlite"));
    database.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      CREATE TABLE api_tokens (id TEXT PRIMARY KEY);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO sessions VALUES ('current-session'); INSERT INTO api_tokens VALUES ('current-token');`);
    database.close();
  }
  writeFileSync(join(decoy, "session-secret.txt"), "decoy-session-signing-secret", { mode: 0o600 });
  writeFileSync(join(decoy, "access-password.txt"), "decoy-runtime-password", { mode: 0o600 });
  const sessionSecret = "configured-cli-session-secret";
  const runtimePassword = "configured-runtime-password";
  writeFileSync(join(root, ".env.local"), `RUBIDIUM_DATA_DIR=configured-data\nRUBIDIUM_SESSION_SECRET=${sessionSecret}\nRUBIDIUM_PASSWORD=${runtimePassword}\n`, { mode: 0o600 });
  const terminal = join(root, "terminal.mjs");
  writeFileSync(terminal, `
    import { PassThrough } from 'node:stream';
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => input;
    Object.defineProperty(process, 'stdin', { value: input });
    const write = process.stdout.write.bind(process.stdout);
    let prompts = 0;
    process.stdout.write = (chunk, ...args) => {
      const result = write(chunk, ...args);
      if (String(chunk).endsWith(': ')) {
        const bytes = Buffer.from(${JSON.stringify(password)});
        const split = ${splitInput} && prompts++ === 0;
        setImmediate(() => {
          if (split) { input.write(bytes.subarray(0, 1)); input.write(bytes.subarray(1)); }
          else input.write(bytes);
          input.write('\\r');
        });
      }
      return result;
    };
  `, { mode: 0o600 });
  const environment = { ...process.env };
  for (const prefix of ["RUBIDIUM", "BARKER"]) {
    for (const name of ["DATA_DIR", "SESSION_SECRET", "PASSWORD"]) delete environment[`${prefix}_${name}`];
  }
  try {
    const result = spawnSync(process.execPath, ["--import", terminal, fileURLToPath(new URL("../scripts/password-reset.mjs", import.meta.url))], {
      cwd: root, env: environment, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(`${result.stdout}\n${result.stderr}`.includes(password), false);
    const target = new DatabaseSync(join(configured, "barker.sqlite"), { readOnly: true });
    const untouched = new DatabaseSync(join(decoy, "barker.sqlite"), { readOnly: true });
    try {
      const row = target.prepare("SELECT value FROM settings WHERE key = 'password_override'").get();
      assert.ok(row, "reset must use the configured data directory");
      const override = JSON.parse(String(row.value)) as { source: string; salt: string; hash: string };
      assert.equal(override.source, createHmac("sha256", sessionSecret).update(runtimePassword).digest("hex"));
      assert.equal(override.hash, scryptSync(password, override.salt, 32).toString("hex"));
      assert.equal(target.prepare("SELECT COUNT(*) count FROM sessions").get()?.count, 0);
      assert.equal(target.prepare("SELECT COUNT(*) count FROM api_tokens").get()?.count, 0);
      assert.equal(untouched.prepare("SELECT value FROM settings WHERE key = 'password_override'").get(), undefined);
      assert.equal(untouched.prepare("SELECT COUNT(*) count FROM sessions").get()?.count, 1);
    } finally { target.close(); untouched.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Docker reset rotates the password and revokes access without changing task data", () => {
  const currentPassword = "before-reset-password-2030";
  const nextPassword = "after-reset-password-2030";
  assert.equal(auth.initializePassword(currentPassword), true);
  const task = database.createTask({
    name: "保留的提醒", startsAt: "2035-01-01T09:00:00+08:00", preset: "daily", cron: "0 9 * * *", repeatCount: 5,
  }, new Date("2030-01-01T00:00:00Z"));
  const session = auth.createSessionToken();
  const apiToken = auth.createApiToken("reset test", "read", 30);
  const revision = database.passwordRevision();

  resetPassword(nextPassword, directory);

  assert.equal(auth.verifyPassword(currentPassword), false);
  assert.equal(auth.verifyPassword(nextPassword), true);
  assert.equal(auth.isValidSessionToken(session), false);
  assert.equal(database.apiTokenValid(createHash("sha256").update(apiToken).digest("hex"), false), false);
  assert.equal(database.passwordRevision(), revision + 1);
  assert.deepEqual(database.listTasks().map((item) => item.id), [task.id]);
  assert.equal(database.getTask(task.id)?.name, "保留的提醒");
  assert.equal(existsSync(join(directory, "access-password.txt")), false);
  assert.equal(JSON.stringify(database.passwordOverride()).includes(nextPassword), false);
});

test("reset rejects weak passwords and missing databases without creating data", () => {
  assert.throws(() => resetPassword("short", directory), /8–300/);
  const emptyDirectory = mkdtempSync(join(tmpdir(), "rubidium-password-reset-empty-"));
  try {
    assert.throws(() => resetPassword("valid-reset-password-2030", emptyDirectory), /database does not exist/);
    assert.equal(existsSync(join(emptyDirectory, "barker.sqlite")), false);
  } finally { rmSync(emptyDirectory, { recursive: true, force: true }); }
});

test("interactive reset refuses non-TTY input without echoing or persisting it", () => {
  const emptyDirectory = mkdtempSync(join(tmpdir(), "rubidium-password-reset-tty-"));
  const secret = "never-echo-this-password";
  try {
    const result = spawnSync(process.execPath, ["scripts/password-reset.mjs"], {
      cwd: process.cwd(), input: `${secret}\n${secret}\n`, encoding: "utf8",
      env: { ...process.env, RUBIDIUM_DATA_DIR: emptyDirectory, RUBIDIUM_PASSWORD: "", RUBIDIUM_SESSION_SECRET: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /必须通过交互终端运行/);
    assert.equal(`${result.stdout}\n${result.stderr}`.includes(secret), false);
    assert.equal(existsSync(join(emptyDirectory, "barker.sqlite")), false);
  } finally { rmSync(emptyDirectory, { recursive: true, force: true }); }
});

test("password reset CLI loads the same local configuration as the server", () => {
  checkConfiguredCliReset("configured-next-password-2035");
});

test("password reset CLI preserves UTF-8 characters split across terminal chunks", () => {
  checkConfiguredCliReset("密码-reset-password-2035", true);
});
