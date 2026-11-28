import { randomBytes, randomUUID, createHmac, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { DATABASE_FILENAME, assertV2DataDirectory } from "../lib/storage-format.mjs";
import { getEnvironmentVariable } from "../lib/environment.mjs";
import { loadRuntimeEnvironment, runtimeDirectory } from "./runtime-paths.mjs";

const MIN_PASSWORD_LENGTH = 8;
const MIN_SECRET_LENGTH = 16;
const MAX_PASSWORD_LENGTH = 300;

function readStoredSecret(directory, name) {
  const path = join(directory, name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

function configuredSecret(environmentName, directory, fileName, minLength) {
  const value = getEnvironmentVariable(environmentName)?.trim() || readStoredSecret(directory, fileName);
  if (value && (value.length < minLength || value.length > MAX_PASSWORD_LENGTH)) {
    throw new Error(`RUBIDIUM_${environmentName} or ${fileName} must contain ${minLength}–${MAX_PASSWORD_LENGTH} characters`);
  }
  return value;
}

export function resetPassword(password, dataDirectory = getEnvironmentVariable("DATA_DIR") || "./data") {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH || password.trim() !== password) {
    throw new Error("Password must contain 8–300 characters and have no leading or trailing spaces");
  }

  const directory = runtimeDirectory(process.cwd(), dataDirectory);
  assertV2DataDirectory(directory);
  const databasePath = join(directory, DATABASE_FILENAME);
  if (!existsSync(databasePath)) throw new Error(`Rubidium database does not exist at ${databasePath}; no data was changed`);
  const sessionSecret = configuredSecret("SESSION_SECRET", directory, "session-secret.txt", MIN_SECRET_LENGTH);
  if (!sessionSecret) throw new Error("Session signing secret is missing; no data was changed");
  const runtimePassword = getEnvironmentVariable("PASSWORD")?.trim() || "";
  if (runtimePassword && (runtimePassword.length < MIN_PASSWORD_LENGTH || runtimePassword.length > MAX_PASSWORD_LENGTH)) throw new Error("RUBIDIUM_PASSWORD must contain 8–300 characters");
  const source = runtimePassword ? createHmac("sha256", sessionSecret).update(runtimePassword).digest("hex") : "setup";
  const salt = randomBytes(32).toString("hex");
  const override = JSON.stringify({ source, salt, hash: scryptSync(password, salt, 32).toString("hex") });
  const database = new DatabaseSync(databasePath);

  try {
    database.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('password_override', ?)").run(override);
      database.exec(`INSERT INTO settings (key, value) VALUES ('password_revision', '1')
        ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`);
      database.exec("DELETE FROM sessions; DELETE FROM api_tokens");
      database.prepare("INSERT INTO audit_events (id, action, target, created_at) VALUES (?, ?, ?, ?)")
        .run(randomUUID(), "security.password.change", "docker-password-reset", new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally { database.close(); }
}

function promptHidden(label) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("必须通过交互终端运行；Docker 请使用 docker compose exec -it。");
  }

  process.stdout.write(label);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolvePrompt, rejectPrompt) => {
    const decoder = new StringDecoder("utf8");
    let value = "";
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.off("data", onData);
      input.pause();
      input.setRawMode(false);
      process.stdout.write("\n");
      if (error) rejectPrompt(error);
      else resolvePrompt(value);
    };
    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") { finish(new Error("Password reset cancelled")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") { value = Array.from(value).slice(0, -1).join(""); continue; }
        if (character >= " ") value += character;
      }
    };
    input.on("data", onData);
  });
}

async function main() {
  if (process.argv.length > 2) throw new Error("不要通过命令参数传递密码，请使用无回显的交互输入。");
  loadRuntimeEnvironment();
  const password = await promptHidden("新访问密码（8-300 个字符）: ");
  const confirmation = await promptHidden("再次输入访问密码: ");
  if (password !== confirmation) throw new Error("两次输入不一致，未修改数据。");
  resetPassword(password);
  console.log("访问密码已更新。旧会话和 API 凭据已撤销，提醒及队列数据已保留。");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(`密码重置失败：${error.message}`);
    process.exitCode = 1;
  });
}
