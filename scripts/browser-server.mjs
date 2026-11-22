import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "rubidium-browser-"));
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit", env: { ...process.env, PORT: process.env.RUBIDIUM_BROWSER_PORT || "3129", HOSTNAME: "127.0.0.1", RUBIDIUM_DATA_DIR: directory, RUBIDIUM_DISABLE_SCHEDULER: "1", RUBIDIUM_PASSWORD: "browser-regression-password", RUBIDIUM_SESSION_SECRET: "browser-regression-session-secret" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(`Browser test server failed to start: ${error.message}`); rmSync(directory, { recursive: true, force: true }); process.exitCode = 1; });
child.once("exit", (code, signal) => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? 1;
});
