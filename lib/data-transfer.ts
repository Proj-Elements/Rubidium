import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors";
import { CURRENT_SCHEMA_VERSION, connection, transaction } from "./db/core";
import { refreshChannelLogSecrets } from "./db";
import { auditEvent } from "./db/security";
import { channelFields, deliverySchema, taskSchema, timestampSchema } from "./contracts";
import { settingsSchema, taskInputSchema } from "./validation";
import { transferPasswordValidationIssue } from "./password-policy";

export const MAX_TRANSFER_BYTES = 40 * 1024 * 1024;
export const MAX_IMPORT_BODY_BYTES = 60 * 1024 * 1024;
const FORMAT = "rubidium-encrypted-export";
const CIPHER = "aes-256-gcm";
const KDF = "scrypt";
const KDF_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const TABLES = ["settings", "tasks", "deliveries", "sessions", "api_tokens", "runtime_state", "devices", "audit_events", "idempotency_keys", "delivery_attempts"];
const REPLACE_TABLES = ["idempotency_keys", "delivery_attempts", "deliveries", "tasks", "devices", "audit_events"];
const COPY_TABLES = ["devices", "tasks", "deliveries", "delivery_attempts", "idempotency_keys", "audit_events"];

export interface EncryptedExport {
  format: typeof FORMAT;
  version: 1;
  schemaVersion: number;
  cipher: typeof CIPHER;
  kdf: typeof KDF;
  salt: string;
  iv: string;
  tag: string;
  payload: string;
}

function validatePassphrase(passphrase: string): void {
  if (transferPasswordValidationIssue(passphrase)) {
    throw new DomainError("加密密码须为 12–200 个字符且不能有首尾空格", 400, { key: "errors.transferPassword" });
  }
}

function aad(schemaVersion: number): Buffer {
  return Buffer.from(`${FORMAT}:1:${schemaVersion}:${CIPHER}:${KDF}`);
}

export function encryptExport(snapshot: Buffer, passphrase: string): EncryptedExport {
  validatePassphrase(passphrase);
  if (snapshot.length > MAX_TRANSFER_BYTES) throw new DomainError("数据快照超过 40 MiB 导出限制", 413);
  const compressed = gzipSync(snapshot);
  if (compressed.length > MAX_TRANSFER_BYTES) throw new DomainError("压缩后的数据快照超过 40 MiB 导出限制", 413);
  const schemaVersion = CURRENT_SCHEMA_VERSION;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, KDF_OPTIONS);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(aad(schemaVersion));
  const payload = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return {
    format: FORMAT, version: 1, schemaVersion, cipher: CIPHER, kdf: KDF,
    salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), payload: payload.toString("base64"),
  };
}

function decodeBase64(value: unknown, maximum: number): Buffer {
  if (typeof value !== "string" || value.length > maximum || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new DomainError("导出文件格式无效");
  }
  return Buffer.from(value, "base64");
}

export function decryptExport(value: unknown, passphrase: string): Buffer {
  validatePassphrase(passphrase);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("导出文件格式无效");
  const envelope = value as Partial<EncryptedExport>;
  if (envelope.format !== FORMAT || envelope.version !== 1 || envelope.cipher !== CIPHER || envelope.kdf !== KDF) {
    throw new DomainError("导出文件版本或加密格式不受支持");
  }
  if (envelope.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new DomainError("导出数据版本与当前 Rubidium 不兼容");
  const salt = decodeBase64(envelope.salt, 24);
  const iv = decodeBase64(envelope.iv, 16);
  const tag = decodeBase64(envelope.tag, 24);
  const payload = decodeBase64(envelope.payload, Math.ceil(MAX_TRANSFER_BYTES * 4 / 3) + 8);
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || payload.length > MAX_TRANSFER_BYTES) throw new DomainError("导出文件格式无效");
  try {
    const key = scryptSync(passphrase, salt, 32, KDF_OPTIONS);
    const decipher = createDecipheriv(CIPHER, key, iv);
    decipher.setAAD(aad(envelope.schemaVersion));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(payload), decipher.final()]);
    return gunzipSync(compressed, { maxOutputLength: MAX_TRANSFER_BYTES });
  } catch {
    throw new DomainError("解密失败：密码错误或导出文件损坏", 400, { key: "errors.decryptFailed" });
  }
}

function validateSnapshot(path: string): void {
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const version = source.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== CURRENT_SCHEMA_VERSION) throw new DomainError("导出数据版本与当前 Rubidium 不兼容");
    const integrity = source.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok" || source.prepare("PRAGMA foreign_key_check").all().length) throw new DomainError("导出数据校验失败");
    const target = connection();
    const schema = (database: DatabaseSync, prefix: string) => database.prepare(`SELECT type, name, tbl_name, sql FROM ${prefix}sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
    if (JSON.stringify(schema(source, "main.")) !== JSON.stringify(schema(target, "main."))) throw new DomainError("导出数据库结构与当前 Rubidium 不兼容");
    if (TABLES.length !== source.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get()?.count) {
      throw new DomainError("导出数据库结构无效");
    }

    const tasks = source.prepare("SELECT * FROM tasks");
    let invalidTask = false;
    for (const raw of tasks.iterate()) {
      const row = raw as Record<string, unknown>;
      let notification: unknown;
      let skipDates: unknown;
      let includeDates: unknown;
      try {
        notification = JSON.parse(String(row.notification));
        skipDates = JSON.parse(String(row.skip_dates));
        includeDates = JSON.parse(String(row.include_dates));
      } catch {
        invalidTask = true;
        continue;
      }
      const input = taskInputSchema.safeParse({
        name: row.name, description: row.description, startsAt: row.starts_at, preset: row.preset, cron: row.cron,
        repeatCount: row.repeat_count, endDate: row.end_date, timeZone: row.time_zone,
        maxLatenessMinutes: row.max_lateness_minutes, deviceId: row.device_id, notification, skipDates, includeDates,
      });
      if (!input.success || !taskSchema.safeParse({
        ...input.data, id: row.id, sentCount: row.sent_count, queuedCount: row.queued_count, pendingCount: 0,
        nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, lastError: row.last_error, status: row.status,
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision, pausedAt: row.paused_at,
      }).success) invalidTask = true;
    }
    if (invalidTask) throw new DomainError("导出提醒数据无效");

    const deliveries = source.prepare(`SELECT deliveries.*, tasks.name task_name FROM deliveries JOIN tasks ON tasks.id = deliveries.task_id`);
    let invalidDelivery = false;
    for (const raw of deliveries.iterate()) {
      const row = raw as Record<string, unknown>;
      if (row.manual_only !== 0 && row.manual_only !== 1) {
        invalidDelivery = true;
        continue;
      }
      if (!deliverySchema.safeParse({
        id: row.id, taskId: row.task_id, taskName: row.title ?? row.task_name, description: row.body,
        deviceId: row.device_id, manualOnly: row.manual_only === 1, occurrenceAt: row.occurrence_at,
        status: row.status, attempts: row.attempts, lastError: row.last_error, nextAttemptAt: row.next_attempt_at,
        deliveredAt: row.delivered_at, createdAt: row.created_at, updatedAt: row.activity_at, expiresAt: row.expires_at,
      }).success) invalidDelivery = true;
    }
    if (invalidDelivery) throw new DomainError("导出投递记录无效");

    if (source.prepare("SELECT 1 FROM tasks WHERE device_id != 'default' AND device_id NOT IN (SELECT id FROM devices) LIMIT 1").get()) {
      throw new DomainError("导出提醒引用了不存在的设备");
    }

    const settings = source.prepare("SELECT value FROM settings WHERE key = 'default'").get() as { value?: string } | undefined;
    if (!settings) throw new DomainError("导出设置数据无效");
    let parsedSettings: unknown;
    try { parsedSettings = JSON.parse(settings.value ?? ""); }
    catch { throw new DomainError("导出设置数据无效"); }
    if (!settingsSchema.safeParse(parsedSettings).success) throw new DomainError("导出设置数据无效");

    const revision = Number((source.prepare("SELECT value FROM settings WHERE key = 'revision'").get() as { value?: string } | undefined)?.value);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new DomainError("导出设置数据无效");

    const devices = source.prepare("SELECT id, name, type, endpoint, topic, device_key, revision FROM devices");
    for (const raw of devices.iterate()) {
      const row = raw as Record<string, unknown>;
      const channel = channelFields.safeParse({
        name: row.name, type: row.type, endpoint: row.endpoint, topic: row.topic, credential: row.device_key,
      });
      if (typeof row.id !== "string" || !row.id.trim() || row.id.length > 100 || !channel.success ||
        (row.id !== "default" && channel.data.type === "bark" && !channel.data.credential) ||
        !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1) {
        throw new DomainError("导出设备数据无效");
      }
    }

    const attempts = source.prepare("SELECT outcome, started_at, finished_at FROM delivery_attempts");
    for (const raw of attempts.iterate()) {
      const row = raw as Record<string, unknown>;
      if (!(["sending", "sent", "failed", "interrupted"] as unknown[]).includes(row.outcome) ||
        !timestampSchema.safeParse(row.started_at).success || (row.finished_at !== null && !timestampSchema.safeParse(row.finished_at).success)) {
        throw new DomainError("导出投递历史无效");
      }
    }

    const audits = source.prepare("SELECT action, target, created_at FROM audit_events");
    for (const raw of audits.iterate()) {
      const row = raw as Record<string, unknown>;
      if (typeof row.action !== "string" || typeof row.target !== "string" || !timestampSchema.safeParse(row.created_at).success) {
        throw new DomainError("导出审计记录无效");
      }
    }

    const idempotencyKeys = source.prepare("SELECT key, fingerprint FROM idempotency_keys");
    for (const raw of idempotencyKeys.iterate()) {
      const row = raw as Record<string, unknown>;
      if (typeof row.key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(row.key) || typeof row.fingerprint !== "string" || !/^[a-f\d]{64}$/.test(row.fingerprint)) {
        throw new DomainError("导出幂等记录无效");
      }
    }
  } finally { source.close(); }
}

export function importDatabaseSnapshot(path: string): void {
  validateSnapshot(path);
  const database = connection();
  database.prepare("ATTACH DATABASE ? AS rubidium_import").run(path);
  try {
    transaction(() => {
      for (const table of REPLACE_TABLES) database.exec(`DELETE FROM ${table}`);
      for (const table of COPY_TABLES) database.exec(`INSERT INTO ${table} SELECT * FROM rubidium_import.${table}`);
      database.exec("DELETE FROM settings WHERE key NOT IN ('password_override', 'password_revision')");
      database.exec("INSERT INTO settings SELECT * FROM rubidium_import.settings WHERE key NOT IN ('password_override', 'password_revision')");
      if (database.prepare("PRAGMA foreign_key_check").all().length) throw new DomainError("导入后的数据完整性校验失败");
      auditEvent("data.import", "encrypted-export");
    });
    refreshChannelLogSecrets();
  } finally { database.exec("DETACH DATABASE rubidium_import"); }
}
