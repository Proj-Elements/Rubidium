import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "rubidium-password-reset-"));
process.env.BARKER_DATA_DIR = directory;
process.env.BARKER_SESSION_SECRET = "rubidium-password-reset-session";
delete process.env.BARKER_PASSWORD;
process.env.BARKER_SETUP_TOKEN = "";
process.env.BARKER_ALLOW_SETUP = "";

let auth: typeof import("../lib/auth");
let database: typeof import("../lib/db");
let resetPassword: typeof import("../scripts/password-reset.mjs").resetPassword;
before(async () => {
  auth = await import("../lib/auth");
  database = await import("../lib/db");
  ({ resetPassword } = await import("../scripts/password-reset.mjs"));
});
after(() => rmSync(directory, { recursive: true, force: true }));

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
  assert.throws(() => resetPassword("short", directory), /16–300/);
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
      env: { ...process.env, BARKER_DATA_DIR: emptyDirectory, BARKER_PASSWORD: "", BARKER_SESSION_SECRET: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /必须通过交互终端运行/);
    assert.equal(`${result.stdout}\n${result.stderr}`.includes(secret), false);
    assert.equal(existsSync(join(emptyDirectory, "barker.sqlite")), false);
  } finally { rmSync(emptyDirectory, { recursive: true, force: true }); }
});
