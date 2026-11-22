import { presetCronFromParts, SCHEDULE_TIME_ZONE, type RecurrencePreset } from "./types";
import { deliverySchema, SECURITY_SESSION_PAGE_SIZE, taskSchema, timestampSchema } from "./contracts";
import { isMessageKey, localeTags, translate, type Locale, type MessageKey, type MessageValues } from "./i18n";

export { SCHEDULE_TIME_ZONE };

const wallFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function validDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

/** HTML/Calendar wall-clock value, with a safe fallback for corrupt stored data. */
export function localInputValue(date = new Date(), timeZone = SCHEDULE_TIME_ZONE): string {
  if (!validDate(date)) return "";
  try {
    if (timeZone === SCHEDULE_TIME_ZONE) return wallFormatter.format(date).replace(" ", "T");
    return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(" ", "T");
  } catch {
    return wallFormatter.format(date).replace(" ", "T");
  }
}

export function localDateValue(date = new Date(), timeZone = SCHEDULE_TIME_ZONE): string {
  return localInputValue(date, timeZone).slice(0, 10);
}

/** Shanghai has no DST in the supported scheduling range. */
export function toOffsetDateTime(value: string, timeZone = SCHEDULE_TIME_ZONE): string {
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall)) return "";
  const wallDate = new Date(wall);
  if (wallDate.toISOString().slice(0, 16) !== value) return "";
  if (timeZone === SCHEDULE_TIME_ZONE) return `${value}:00+08:00`;
  const candidates = new Set<number>();
  for (const offset of [-36, 0, 36]) {
    const probe = wall + offset * 3_600_000;
    const display = localInputValue(new Date(probe), timeZone);
    const difference = Date.parse(`${display}:00Z`) - Math.floor(probe / 60_000) * 60_000;
    const candidate = wall - difference;
    if (localInputValue(new Date(candidate), timeZone) === value) candidates.add(candidate);
  }
  return candidates.size ? new Date(Math.min(...candidates)).toISOString() : "";
}

export function duplicateStart(task: { startsAt: string; nextRunAt: string | null; timeZone?: string }, now = new Date()): string {
  return localInputValue(new Date(task.nextRunAt ?? task.startsAt ?? now.toISOString()), task.timeZone);
}

/** Generate preset cron without shipping the scheduler library to the browser. */
export function clientPresetCron(preset: RecurrencePreset, startsAt: string): string {
  const [date, time] = startsAt.split("T");
  if (!date || !time) return "";
  const [hour, minute] = time.split(":").map(Number);
  const day = Number(date.slice(8, 10));
  const dateValue = new Date(`${date}T00:00:00Z`);
  if (!validDate(dateValue) || dateValue.toISOString().slice(0, 10) !== date) return "";
  const weekday = dateValue.getUTCDay();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(day) || !Number.isInteger(weekday)) return "";
  return presetCronFromParts(preset, { hour, minute, day, weekday });
}

/** getRandomValues works on ordinary HTTP LAN deployments where randomUUID may be unavailable. */
export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function formatTime(value: string | null, options?: Intl.DateTimeFormatOptions, locale: Locale = "zh-CN"): string {
  if (!value) return translate(locale, "common.noSchedule");
  const date = new Date(value);
  if (!validDate(date)) return translate(locale, "common.invalidTime");
  return new Intl.DateTimeFormat(localeTags[locale], {
    timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", ...options,
  }).format(date);
}

export function clockTime(value: string, timeZone = SCHEDULE_TIME_ZONE, locale: Locale = "zh-CN"): string {
  const date = new Date(value);
  if (!validDate(date)) return translate(locale, "common.invalidTime");
  return new Intl.DateTimeFormat(localeTags[locale], { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function errorMessage(error: unknown, locale?: Locale): string {
  if (!(error instanceof Error)) return translate(locale ?? "zh-CN", "common.operationFailed");
  const localized = error instanceof ApiError ? error.localized : undefined;
  if (locale && localized) return translate(locale, localized.key, localized.values);
  if (!locale || locale === "zh-CN") return error.message;
  if (/\p{Script=Han}/u.test(error.message)) return translate(locale, "common.operationFailed");
  return error.message;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly localized?: { key: MessageKey; values?: MessageValues }) { super(message); }
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonNegativeInteger(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) >= 0; }
function dateValue(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function timestampValue(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function nullableTimestamp(value: unknown): boolean { return value === null || timestampValue(value); }
function taskValue(value: unknown): boolean {
  return taskSchema.safeParse(value).success;
}
function deliveryValue(value: unknown): boolean {
  return deliverySchema.safeParse(value).success;
}
function paginationValue(value: Record<string, unknown>): boolean {
  return nonNegativeInteger(value.total) && Number.isSafeInteger(value.page) && Number(value.page) > 0
    && Number.isSafeInteger(value.pageSize) && Number(value.pageSize) > 0 && Number(value.pageSize) <= 50;
}

export function validApiPayload(url: string, data: unknown): boolean {
  if (!objectValue(data)) return false;
  const object = data;
  const path = url.split("?")[0];
  if (path === "/api/session") {
    if (typeof object.authenticated !== "boolean") return false;
    if (!("initialized" in object)) return true;
    return typeof object.initialized === "boolean" && typeof object.setupEnabled === "boolean" && typeof object.setupTokenRequired === "boolean";
  }
  if (path === "/api/overview") return Array.isArray(object.tasks) && object.tasks.every(taskValue)
    && Array.isArray(object.upcoming) && object.upcoming.every((item) => objectValue(item) && typeof item.taskId === "string" && timestampValue(item.occurrenceAt))
    && Array.isArray(object.upcomingDays) && object.upcomingDays.every((item) => objectValue(item) && dateValue(item.date) && nonNegativeInteger(item.total) && nonNegativeInteger(item.hidden))
    && Array.isArray(object.recent) && object.recent.every(deliveryValue)
    && Array.isArray(object.activity) && object.activity.every((item) => objectValue(item) && dateValue(item.date) && nonNegativeInteger(item.sent))
    && objectValue(object.stats) && ["active", "paused", "todaySent", "totalSent"].every((key) => nonNegativeInteger((object.stats as Record<string, unknown>)[key]))
    && objectValue(object.deliveries) && nonNegativeInteger(object.deliveries.pending) && nonNegativeInteger(object.deliveries.retrying) && nullableTimestamp(object.deliveries.nextRetryAt)
    && typeof object.endpoint === "string" && typeof object.deviceKeyConfigured === "boolean"
    && objectValue(object.defaultChannel) && (object.defaultChannel.type === "bark" || object.defaultChannel.type === "ntfy")
    && typeof object.defaultChannel.credentialConfigured === "boolean" && timestampValue(object.serverTime);
  if (path === "/api/tasks/preview") return Array.isArray(object.dates) && object.dates.every((value) => timestampSchema.safeParse(value).success);
  if (path === "/api/settings") {
    if (!Number.isSafeInteger(object.revision) || Number(object.revision) < 1) return false;
    if (object.saved === true) return true;
    return objectValue(object.settings) && ["endpoint", "title", "sound", "group", "icon"].every((key) => typeof (object.settings as Record<string, unknown>)[key] === "string")
      && typeof object.deviceKeyConfigured === "boolean" && typeof object.dataDir === "string";
  }
  if (path === "/api/settings/test") return object.delivered === true;
  if (path === "/api/tasks" || /^\/api\/tasks\/[^/]+$/.test(path)) {
    if ("task" in object) return taskValue(object.task);
    if (object.archived === true || object.deleted === true || Array.isArray(object.results)) return true;
    return Array.isArray(object.tasks) && object.tasks.every(taskValue) && (!("total" in object) || paginationValue(object));
  }
  if (path === "/api/deliveries") return nonNegativeInteger(object.removed)
    || Array.isArray(object.results)
    || (Array.isArray(object.deliveries) && object.deliveries.every(deliveryValue) && paginationValue(object));
  if (/^\/api\/deliveries\/[^/]+\/attempts$/.test(path)) return Array.isArray(object.attempts)
    && object.attempts.every((item) => objectValue(item) && typeof item.id === "string" && typeof item.deliveryId === "string"
      && timestampValue(item.startedAt) && nullableTimestamp(item.finishedAt) && ["sending", "sent", "failed", "interrupted"].includes(String(item.outcome))
      && (item.error === null || typeof item.error === "string"));
  if (/^\/api\/deliveries\/[^/]+\/retry$/.test(path)) return object.queued === true;
  if (/^\/api\/deliveries\/[^/]+\/cancel$/.test(path)) return object.cancelled === true;
  if (/^\/api\/deliveries\/[^/]+$/.test(path)) return object.saved === true;
  if (path === "/api/devices") return (Array.isArray(object.devices) && object.devices.every((device) => objectValue(device) && typeof device.id === "string" && typeof device.endpoint === "string" && typeof device.deviceKeyConfigured === "boolean")) || objectValue(object.device) || object.deleted === true;
  if (path === "/api/channels") {
    const channelValue = (value: unknown) => objectValue(value) && typeof value.id === "string" && typeof value.name === "string"
      && (value.type === "bark" || value.type === "ntfy") && typeof value.endpoint === "string" && typeof value.topic === "string"
      && typeof value.credentialConfigured === "boolean" && Number.isSafeInteger(value.revision) && Number(value.revision) > 0 && typeof value.isDefault === "boolean"
      && !("credential" in value) && !("deviceKey" in value);
    if (Array.isArray(object.channels)) return object.channels.every(channelValue);
    return channelValue(object.channel) || object.deleted === true;
  }
  if (/^\/api\/channels\/[^/]+\/test$/.test(path)) return object.delivered === true;
  if (path === "/api/security") return object.saved === true || object.revoked === true || typeof object.token === "string"
    || (Array.isArray(object.sessions) && Array.isArray(object.tokens) && objectValue(object.sessionPagination)
      && paginationValue(object.sessionPagination) && Number(object.sessionPagination.pageSize) === SECURITY_SESSION_PAGE_SIZE
      && object.sessions.length <= Number(object.sessionPagination.pageSize));
  if (path === "/api/data/export") return object.format === "rubidium-encrypted-export" && object.version === 1 && typeof object.payload === "string";
  if (path === "/api/data/import") return object.imported === true;
  if (path === "/api/audit") return Array.isArray(object.events);
  if (path === "/api/upcoming") return Array.isArray(object.items) && nonNegativeInteger(object.total);
  return false;
}

/** Same-origin session API; a 401 returns the entire workspace to the access gate. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000);
  try {
  const response = await fetch(url, {
    ...init, cache: "no-store", credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
    signal: init?.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal,
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new ApiError("服务返回了非 JSON 响应，请检查网络或反向代理", response.status, { key: "errors.invalidResponse" });
  let data: T & { error?: string; errorKey?: unknown; errorValues?: unknown };
  try { data = await response.json() as T & { error?: string; errorKey?: unknown; errorValues?: unknown }; }
  catch { throw new ApiError("服务响应损坏，请重新同步", response.status, { key: "errors.corruptResponse" }); }
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/session" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("barker:unauthorized"));
    }
    const key = isMessageKey(data?.errorKey) ? data.errorKey : undefined;
    const values = data?.errorValues && typeof data.errorValues === "object" && !Array.isArray(data.errorValues)
      && Object.values(data.errorValues).every((value) => typeof value === "string" || typeof value === "number")
      ? data.errorValues as MessageValues : undefined;
    throw new ApiError(typeof data?.error === "string" ? data.error : `请求失败 (${response.status})`, response.status, key ? { key, values } : undefined);
  }
  if (!validApiPayload(url, data)) throw new ApiError("服务响应格式无效，请重新同步", response.status, { key: "errors.invalidPayload" });
  return data;
  } finally { clearTimeout(timer); }
}
