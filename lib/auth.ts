import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiTokenValid, auditEvent, passwordOverride, passwordRevision, persistSession, readSettings, removeSession, revokeOtherPasswordSessions, saveApiToken, saveInitialPasswordOverride, savePasswordOverride, sessionExists, transaction, writeSettings, PERMANENT_CREDENTIAL_EXPIRY } from "./db";
import { timeZoneSchema } from "./contracts";
import { DomainError } from "./errors";
import { initializeStorage, privateFile, runtimeDataDir } from "./storage";
import { setLogSecret } from "./logging";
import { MIN_PASSWORD_LENGTH, passwordValidationLocalized, passwordValidationMessage } from "./password-policy";
import { getEnvironmentVariable } from "./environment.mjs";

const AUTH_COOKIE = "barker_session";
const SESSION_DURATION_SECONDS = 12 * 60 * 60;
/** A shorter secret is guessable enough to forge session cookies / log in. */
const MIN_SECRET_LENGTH = 16;
const MIN_SETUP_TOKEN_LENGTH = 32;
export const MAX_SECRET_LENGTH = 300;

function readSecretFile(path: string): string | null {
  try {
    return readFileSync(/* turbopackIgnore: true */ path, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function loadOrCreateSecret(name: string, configuredValue?: string): string {
  const configured = configuredValue?.trim();
  if (configured) {
    if (configured.length < MIN_SECRET_LENGTH) {
      throw new Error(`Rubidium secret ${name} must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    if (configured.length > MAX_SECRET_LENGTH) throw new Error(`Rubidium secret ${name} must be at most ${MAX_SECRET_LENGTH} characters`);
    return configured;
  }

  const path = join(/* turbopackIgnore: true */ runtimeDataDir, name);
  privateFile(path);
  const existing = readSecretFile(path);
  if (existing !== null) {
    if (existing.length > MAX_SECRET_LENGTH) throw new Error(`Rubidium secret ${name} must be at most ${MAX_SECRET_LENGTH} characters`);
    if (existing.length >= MIN_SECRET_LENGTH) return existing;
    // Fail fast instead of silently accepting an empty or truncated session key.
    throw new Error(
      `Rubidium secret file ${path} is empty or too short. Delete it and restart to regenerate a fresh secret.`,
    );
  }

  const generated = randomBytes(32).toString("base64url");
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, `${generated}\n`, { mode: 0o600, flag: "wx" });
  try {
    // link() is atomic create-if-absent: concurrent workers all agree on the
    // winner instead of each keeping its own secret.
    linkSync(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = readSecretFile(path);
    if (winner === null || winner.length < MIN_SECRET_LENGTH || winner.length > MAX_SECRET_LENGTH) {
      throw new Error(`Unable to persist Rubidium secret ${name}`);
    }
    return winner;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // best effort cleanup of the temporary file
    }
  }
  return generated;
}

let runtimePassword = "";
let sessionSecret = "";
let passwordFingerprint = "";
let initialized = false;
let credential: { hash: string; salt: string } | null = null;
let credentialRevision: number | undefined;
let credentialSource: string | undefined;
let knownPasswordOverride: { source: string; hash: string; password: string } | null = null;

function loadConfiguredPassword(): string | null {
  const configured = getEnvironmentVariable("PASSWORD")?.trim();
  if (configured) {
    if (configured.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`RUBIDIUM_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (configured.length > MAX_SECRET_LENGTH) throw new Error(`RUBIDIUM_PASSWORD must be at most ${MAX_SECRET_LENGTH} characters`);
    return configured;
  }

  const path = join(/* turbopackIgnore: true */ runtimeDataDir, "access-password.txt");
  privateFile(path);
  const existing = readSecretFile(path);
  if (existing === null) return null;
  const invalidPassword = passwordValidationMessage(existing);
  if (invalidPassword) throw new Error(`Rubidium access password file ${path}: ${invalidPassword}`);
  return existing;
}

function loadSetupToken(): string | null {
  const configured = getEnvironmentVariable("SETUP_TOKEN")?.trim();
  if (!configured) return null;
  if (configured.length < MIN_SETUP_TOKEN_LENGTH || configured.length > MAX_SECRET_LENGTH) {
    throw new Error(`RUBIDIUM_SETUP_TOKEN must be ${MIN_SETUP_TOKEN_LENGTH}-${MAX_SECRET_LENGTH} characters`);
  }
  return configured;
}

function enabledByEnvironment(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

export function initializeAuth(): void {
  if (!initialized) {
    initializeStorage();
    sessionSecret = loadOrCreateSecret("session-secret.txt", getEnvironmentVariable("SESSION_SECRET"));
    setLogSecret("auth:session-secret", sessionSecret);
    initialized = true;
  }
  const setupToken = loadSetupToken();
  runtimePassword = loadConfiguredPassword() ?? "";
  refreshCredential(setupToken);
}

function refreshCredential(setupToken = loadSetupToken()): void {
  const revision = passwordRevision();
  const source = runtimePassword
    ? createHmac("sha256", sessionSecret).update(runtimePassword).digest("hex")
    : "setup";
  if (credentialRevision === revision && credentialSource === source) {
    setLogSecret("auth:setup-token", runtimePassword || credential ? null : setupToken);
    return;
  }
  const raw = passwordOverride();
  const override = raw ? JSON.parse(raw) as { source: string; hash: string; salt: string } : null;
  const nextCredential = override?.source === source ? override : null;
  const knownOverridePassword = nextCredential && knownPasswordOverride?.source === source && knownPasswordOverride.hash === nextCredential.hash
    ? knownPasswordOverride.password
    : null;
  const activePassword = nextCredential ? knownOverridePassword ?? "" : runtimePassword;
  if (knownPasswordOverride && !knownOverridePassword) knownPasswordOverride = null;
  setLogSecret("auth:password", activePassword);
  setLogSecret("auth:setup-token", runtimePassword || nextCredential ? null : setupToken);
  const nextFingerprint = createHmac("sha256", sessionSecret).update(nextCredential?.hash ?? (runtimePassword || "unconfigured")).digest("hex");
  if (nextFingerprint !== passwordFingerprint) {
    revokeOtherPasswordSessions(nextFingerprint);
    passwordFingerprint = nextFingerprint;
  }
  credential = nextCredential;
  credentialRevision = revision;
  credentialSource = source;
}
const failedLogins = new Map<string, { count: number; firstFailureAt: number; lockedUntil: number }>();
const FAILED_LOGIN_WINDOW_MS = 10 * 60_000;
const FAILED_LOGIN_LOCKOUT_MS = 10 * 60_000;
const GLOBAL_FAILED_LOGIN_LOCKOUT_MS = 30_000;
// With trusted proxy headers an attacker can rotate client keys freely, so keep the
// in-memory limiter bounded instead of letting it grow with every new address.
const MAX_FAILED_LOGIN_ENTRIES = 1000;
let globalFailures = { count: 0, firstFailureAt: 0, lockedUntil: 0 };

function pruneFailedLogins(now: number): void {
  // Drop clients whose failure window and lockout have both expired.
  for (const [clientKey, state] of failedLogins) {
    if (now - state.firstFailureAt >= FAILED_LOGIN_WINDOW_MS && state.lockedUntil <= now) failedLogins.delete(clientKey);
  }
  const overflow = failedLogins.size - MAX_FAILED_LOGIN_ENTRIES;
  if (overflow <= 0) return;
  // Then evict the oldest windows (preferring long-dead clients) until back under the cap.
  const oldestKeys = [...failedLogins]
    .sort(([, left], [, right]) => left.firstFailureAt - right.firstFailureAt)
    .slice(0, overflow)
    .map(([clientKey]) => clientKey);
  for (const clientKey of oldestKeys) failedLogins.delete(clientKey);
}

function sign(value: string): string {
  initializeAuth();
  return createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE;
}

export function passwordIsConfigured(): boolean {
  initializeAuth();
  return Boolean(runtimePassword || passwordOverride());
}

export function setupConfiguration(): { enabled: boolean; tokenRequired: boolean } {
  initializeAuth();
  if (passwordIsConfigured()) return { enabled: false, tokenRequired: false };
  const tokenRequired = loadSetupToken() !== null;
  return {
    enabled: tokenRequired || enabledByEnvironment(getEnvironmentVariable("ALLOW_SETUP")),
    tokenRequired,
  };
}

export function verifySetupToken(candidate: unknown): boolean {
  initializeAuth();
  const configured = loadSetupToken();
  if (!configured || typeof candidate !== "string" || candidate.length > MAX_SECRET_LENGTH) return false;
  const expected = createHash("sha256").update(configured).digest();
  const actual = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(actual, expected);
}

export function initializePassword(password: string, timeZone?: string): boolean {
  initializeAuth();
  if (passwordIsConfigured()) return false;
  const invalidPassword = passwordValidationMessage(password);
  if (invalidPassword) throw new DomainError(invalidPassword, 400, passwordValidationLocalized(password));
  const salt = randomBytes(32).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  if (timeZone !== undefined && !timeZoneSchema.safeParse(timeZone).success) throw new DomainError("时区必须是有效的 IANA 时区");
  const saved = transaction(() => {
    const created = saveInitialPasswordOverride(JSON.stringify({ source: "setup", salt, hash }));
    if (created && timeZone) writeSettings({ ...readSettings(), displayTimeZone: timeZone });
    return created;
  });
  if (!saved) {
    refreshCredential();
    return false;
  }
  knownPasswordOverride = { source: "setup", hash, password };
  refreshCredential();
  return true;
}

export function authConfigurationReady(): boolean {
  initializeAuth();
  return sessionSecret.length >= MIN_SECRET_LENGTH;
}

export function verifyPassword(candidate: string, now = Date.now(), clientKey = "local"): boolean {
  initializeAuth();
  if (!runtimePassword && !credential) return false;
  if (loginRetryAfter(clientKey, now) > 0) return false;
  const state = failedLogins.get(clientKey);
  const candidateDigest = credential ? scryptSync(candidate, credential.salt, 32) : createHmac("sha256", sessionSecret).update(candidate).digest();
  const expectedDigest = credential ? Buffer.from(credential.hash, "hex") : createHmac("sha256", sessionSecret).update(runtimePassword).digest();
  const matches = timingSafeEqual(candidateDigest, expectedDigest);
  if (matches) {
    failedLogins.delete(clientKey);
    return true;
  }
  const activeWindow = state && now - state.firstFailureAt < FAILED_LOGIN_WINDOW_MS ? state : { count: 0, firstFailureAt: now, lockedUntil: 0 };
  activeWindow.count += 1;
  if (activeWindow.count >= 5) {
    activeWindow.lockedUntil = now + FAILED_LOGIN_LOCKOUT_MS;
    activeWindow.count = 0;
  }
  failedLogins.set(clientKey, activeWindow);
  if (now - globalFailures.firstFailureAt >= FAILED_LOGIN_WINDOW_MS) globalFailures = { count: 0, firstFailureAt: now, lockedUntil: 0 };
  globalFailures.count += 1;
  if (globalFailures.count >= MAX_FAILED_LOGIN_ENTRIES) {
    globalFailures = { count: 0, firstFailureAt: now, lockedUntil: now + GLOBAL_FAILED_LOGIN_LOCKOUT_MS };
  }
  pruneFailedLogins(now);
  return false;
}

export function loginRetryAfter(clientKey: string, now = Date.now()): number {
  const until = Math.max(failedLogins.get(clientKey)?.lockedUntil ?? 0, globalFailures.lockedUntil);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function createSessionToken(now = Date.now()): string {
  initializeAuth();
  const id = randomUUID();
  const exp = now + SESSION_DURATION_SECONDS * 1000;
  persistSession(id, exp, passwordFingerprint, now);
  auditEvent("session.create", id);
  const payload = Buffer.from(JSON.stringify({ id, exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function isValidSessionToken(token: string | null | undefined, now = Date.now()): boolean {
  if (!token || token.length > 1024) return false;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length) return false;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  let decoded: { id?: string; exp?: number } | null;
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof decoded; }
  catch { return false; }
  return Boolean(decoded && typeof decoded.id === "string" && typeof decoded.exp === "number" && Number.isFinite(decoded.exp)
    && decoded.exp > now && sessionExists(decoded.id, passwordFingerprint, now));
}

export function revokeSessionToken(token: string | null): void {
  if (!isValidSessionToken(token)) return;
  const decoded = JSON.parse(Buffer.from(token!.split(".")[0], "base64url").toString("utf8")) as { id: string };
  removeSession(decoded.id);
  auditEvent("session.logout", decoded.id);
}

export function getCookieValue(header: string | null, name = AUTH_COOKIE): string | null {
  if (!header) return null;
  for (const cookie of header.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function requestIsAuthorized(request: Request): boolean {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const value = bearer.slice(7);
    if (value.length > 128) return false;
    return apiTokenValid(createHash("sha256").update(value).digest("hex"), !["GET", "HEAD"].includes(request.method));
  }
  return isValidSessionToken(getCookieValue(request.headers.get("cookie")));
}

export function changePassword(current: string, next: string, clientKey: string): void {
  const invalidPassword = passwordValidationMessage(next);
  if (invalidPassword) throw new DomainError(invalidPassword, 400, passwordValidationLocalized(next));
  if (!verifyPassword(current, Date.now(), clientKey)) throw new DomainError("当前密码错误或尝试次数过多", loginRetryAfter(clientKey) ? 429 : 403, { key: "errors.currentPasswordInvalid" });
  const salt = randomBytes(32).toString("hex");
  const source = runtimePassword ? createHmac("sha256", sessionSecret).update(runtimePassword).digest("hex") : "setup";
  const hash = scryptSync(next, salt, 32).toString("hex");
  savePasswordOverride(JSON.stringify({ source, salt, hash }));
  knownPasswordOverride = { source, hash, password: next };
  refreshCredential();
}

export function createApiToken(name: string, scope: "read" | "write", days: number): string {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = days === 0 ? PERMANENT_CREDENTIAL_EXPIRY : Date.now() + days * 86_400_000;
  saveApiToken(randomUUID(), name, createHash("sha256").update(token).digest("hex"), scope, expiresAt);
  return token;
}

export function trustsProxyHeaders(): boolean {
  const value = getEnvironmentVariable("TRUST_PROXY")?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function clientKeyFor(request: Request): string {
  if (trustsProxyHeaders()) {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  return "local";
}

export function requestUsesHttps(request: Request): boolean {
  // `request.url` is built by Next from x-forwarded-proto, i.e. attacker-spoofable,
  // so never derive Secure-cookie decisions from it. Only an explicitly trusted
  // proxy (or the cookie-secure override) may claim HTTPS.
  const forced = getEnvironmentVariable("COOKIE_SECURE")?.trim().toLowerCase();
  if (forced === "1" || forced === "true" || forced === "yes") return true;
  if (!trustsProxyHeaders()) return false;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https";
}

export function setSessionCookie(token: string, isHttps = false): string {
  const secure = isHttps ? "; Secure" : "";
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secure}`;
}

export function clearSessionCookie(isHttps = false): string {
  const secure = isHttps ? "; Secure" : "";
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function __failedLoginsSizeForTests(): number {
  return failedLogins.size;
}

export function __pruneFailedLoginsForTests(now: number): number {
  pruneFailedLogins(now);
  return failedLogins.size;
}
