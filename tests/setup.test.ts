import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "rubidium-setup-"));
process.env.BARKER_DATA_DIR = directory;
process.env.BARKER_SESSION_SECRET = "rubidium-setup-session-secret";
delete process.env.BARKER_PASSWORD;

let auth: typeof import("../lib/auth");
let session: typeof import("../app/api/session/route");
before(async () => {
  auth = await import("../lib/auth");
  session = await import("../app/api/session/route");
});
after(() => rmSync(directory, { recursive: true, force: true }));

function request(body?: unknown, cookie?: string): Request {
  return new Request("http://localhost:3000/api/session", {
    method: body ? "POST" : "GET",
    headers: { host: "localhost:3000", ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("first boot requires one-time setup and persists only a password hash", async () => {
  const initial = await session.GET(request());
  assert.deepEqual(await initial.json(), { authenticated: false, initialized: false });

  const login = await session.POST(request({ password: "not-configured-password" }));
  assert.equal(login.status, 428);

  const weak = await session.POST(request({ mode: "setup", password: "too-short" }));
  assert.equal(weak.status, 400);
  assert.equal(auth.passwordIsConfigured(), false);
  assert.equal((await session.POST(request({ mode: "setup", password: "first-install-password-2030", timeZone: "Invalid/Zone" }))).status, 400);
  assert.equal(auth.passwordIsConfigured(), false);

  const password = "first-install-password-2030";
  const setup = await session.POST(request({ mode: "setup", password, timeZone: "Europe/Paris" }));
  assert.equal(setup.status, 200);
  assert.match(setup.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax/);
  assert.equal(auth.verifyPassword(password), true);
  assert.equal((await import("../lib/db")).readSettings().displayTimeZone, "Europe/Paris");
  assert.equal(auth.verifyPassword("another-password-value"), false);
  assert.equal(existsSync(join(directory, "access-password.txt")), false);
  const override = JSON.parse((await import("../lib/db")).passwordOverride()!) as { hash: string };
  assert.equal(override.hash.length, 64);
  assert.equal(JSON.stringify(override).includes(password), false);

  const cookie = setup.headers.get("set-cookie")!.split(";")[0];
  assert.deepEqual(await (await session.GET(request(undefined, cookie))).json(), { authenticated: true, initialized: true });
  const token = auth.getCookieValue(cookie);
  assert.ok(token);
  const restored = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `const auth = await import('./lib/auth.ts'); console.log(JSON.stringify({ configured: auth.passwordIsConfigured(), accepted: auth.verifyPassword(${JSON.stringify(password)}), session: auth.isValidSessionToken(${JSON.stringify(token)}) }));`], {
    cwd: process.cwd(), env: { ...process.env, BARKER_DATA_DIR: directory, BARKER_PASSWORD: "", BARKER_SESSION_SECRET: "rubidium-setup-session-secret" }, encoding: "utf8",
  });
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(JSON.parse(restored.stdout.trim()), { configured: true, accepted: true, session: true });
  const changedPassword = "changed-setup-password-2030";
  auth.changePassword(password, changedPassword, "setup-password-change");
  assert.equal(auth.verifyPassword(password), false);
  assert.equal(auth.verifyPassword(changedPassword), true);
  assert.equal(auth.isValidSessionToken(token), false);
  assert.equal((await session.POST(request({ mode: "setup", password }))).status, 409);
  assert.equal((await session.POST(request({ password: changedPassword }))).status, 200);
});

test("existing generated password files remain valid for upgraded installs", () => {
  const legacyDirectory = mkdtempSync(join(tmpdir(), "rubidium-legacy-password-"));
  const password = "legacy-install-password-2030";
  writeFileSync(join(legacyDirectory, "access-password.txt"), `${password}\n`, { mode: 0o600 });
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `const auth = await import('./lib/auth.ts'); console.log(JSON.stringify({ configured: auth.passwordIsConfigured(), accepted: auth.verifyPassword(${JSON.stringify(password)}) }));`], {
      cwd: process.cwd(), env: { ...process.env, BARKER_DATA_DIR: legacyDirectory, BARKER_PASSWORD: "", BARKER_SESSION_SECRET: "rubidium-legacy-session-secret" }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { configured: true, accepted: true });
  } finally { rmSync(legacyDirectory, { recursive: true, force: true }); }
});

function runSetupWorker(dataDir: string, password: string): Promise<{ initialized: boolean; accepted: boolean }> {
  return new Promise((resolve, reject) => {
    const code = `const auth = await import('./lib/auth.ts'); const initialized = auth.initializePassword(${JSON.stringify(password)}); console.log(JSON.stringify({ initialized, accepted: auth.verifyPassword(${JSON.stringify(password)}) }));`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
      cwd: process.cwd(), env: { ...process.env, BARKER_DATA_DIR: dataDir, BARKER_PASSWORD: "", BARKER_SESSION_SECRET: "rubidium-race-session-secret" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => {
      if (status !== 0) { reject(new Error(stderr || `Setup worker exited with ${status}`)); return; }
      try { resolve(JSON.parse(stdout.trim()) as { initialized: boolean; accepted: boolean }); }
      catch { reject(new Error(`Invalid setup worker response: ${stdout}`)); }
    });
  });
}

test("simultaneous initial password writes have a single winner", async () => {
  const raceDirectory = mkdtempSync(join(tmpdir(), "rubidium-setup-race-"));
  try {
    const results = await Promise.all([
      runSetupWorker(raceDirectory, "first-racing-password-2030"),
      runSetupWorker(raceDirectory, "second-racing-password-2030"),
    ]);
    assert.equal(results.filter((result) => result.initialized).length, 1);
    assert.equal(results.filter((result) => result.accepted).length, 1);
  } finally { rmSync(raceDirectory, { recursive: true, force: true }); }
});
