import { backup, DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, copyFileSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, readSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { loadRuntimeEnvironment, runtimeDirectory } from "./runtime-paths.mjs";

const names = ["barker.sqlite", "access-password.txt", "session-secret.txt"];
const encryptedMagic = Buffer.from("RUBIDIUM-OPS-BACKUP-1\n", "ascii");
const encryptedSaltBytes = 16;
const encryptedIvBytes = 12;
const encryptedTagBytes = 16;
const encryptedHeaderBytes = encryptedMagic.length + encryptedSaltBytes + encryptedIvBytes;
const encryptionKeyFileNames = [...names, "manifest.json"];
const encryptedFileNames = encryptionKeyFileNames.map((name) => `${name}.enc`);
const MIN_BACKUP_KEY_BYTES = 16;
const MAX_BACKUP_KEY_BYTES = 1024;
const backupScryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MAX_SUPPORTED_SCHEMA_VERSION = 5;
async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** A portable snapshot has no WAL dependency or transient sidecars. */
function sealSnapshot(path) {
  const database = new DatabaseSync(path);
  try { database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"); }
  finally { database.close(); }
}

async function fileDigests(directory) {
  const files = {};
  for (const name of names) if (existsSync(join(directory, name))) files[name] = await digest(join(directory, name));
  return files;
}

function verifyDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error("Database integrity check failed");
    if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database foreign keys are invalid");
    const version = database.prepare("PRAGMA user_version").get().user_version;
    if (version > MAX_SUPPORTED_SCHEMA_VERSION) throw new Error(`Unsupported schema version ${version}`);
    for (const table of ["tasks", "deliveries", "settings"]) database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    return version;
  } finally { database.close(); }
}

function regularFile(path) {
  if (!lstatSync(path).isFile()) throw new Error(`Expected a regular file: ${path}`);
}

function isSameOrWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return !isAbsolute(path) && path.split(sep, 1)[0] !== "..";
}

function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return join(realpathSync(dirname(absolute)), basename(absolute));
  }
}

function createPrivateDirectory(path) {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) {
    if (error?.code === "EEXIST") throw new Error("Target directory already exists; choose a new directory");
    throw error;
  }
}

function validateBackupKey(password) {
  if (typeof password !== "string") throw new Error("BARKER_BACKUP_KEY must contain a string passphrase");
  const passwordBytes = Buffer.byteLength(password);
  if (passwordBytes < MIN_BACKUP_KEY_BYTES || passwordBytes > MAX_BACKUP_KEY_BYTES) {
    throw new Error(`BARKER_BACKUP_KEY must contain ${MIN_BACKUP_KEY_BYTES} to ${MAX_BACKUP_KEY_BYTES} UTF-8 bytes`);
  }
}

function backupKeyFromEnvironment() {
  const path = process.env.BARKER_BACKUP_KEY_FILE;
  if (!path) return process.env.BARKER_BACKUP_KEY;
  regularFile(path);
  const metadata = lstatSync(path);
  if ((metadata.mode & 0o077) !== 0) throw new Error("BARKER_BACKUP_KEY_FILE must not be accessible by group or other users");
  if (metadata.size > MAX_BACKUP_KEY_BYTES) throw new Error(`BARKER_BACKUP_KEY_FILE exceeds ${MAX_BACKUP_KEY_BYTES} bytes`);
  return readFileSync(path, "utf8");
}

function deriveBackupKey(password, salt) {
  validateBackupKey(password);
  return scryptSync(password, salt, 32, backupScryptOptions);
}

async function encryptBackupFile(source, destination, password) {
  regularFile(source);
  const salt = randomBytes(encryptedSaltBytes);
  const iv = randomBytes(encryptedIvBytes);
  const key = deriveBackupKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  try {
    writeFileSync(destination, Buffer.concat([encryptedMagic, salt, iv]), { flag: "wx", mode: 0o600 });
    await pipeline(createReadStream(source), cipher, createWriteStream(destination, { flags: "a", mode: 0o600 }));
    appendFileSync(destination, cipher.getAuthTag());
    chmodSync(destination, 0o600);
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  } finally { key.fill(0); }
}

function readExactly(descriptor, length, position) {
  const value = Buffer.alloc(length);
  let readOffset = 0;
  while (readOffset < length) {
    const bytesRead = readSync(descriptor, value, readOffset, length - readOffset, position + readOffset);
    if (!bytesRead) throw new Error("Encrypted backup file is truncated");
    readOffset += bytesRead;
  }
  return value;
}

async function decryptBackupFile(source, destination, password) {
  regularFile(source);
  const fileSize = statSync(source).size;
  if (fileSize < encryptedHeaderBytes + encryptedTagBytes + 1) throw new Error("Encrypted backup file is truncated");
  const descriptor = openSync(source, "r");
  let header;
  let tag;
  try {
    header = readExactly(descriptor, encryptedHeaderBytes, 0);
    tag = readExactly(descriptor, encryptedTagBytes, fileSize - encryptedTagBytes);
  } finally { closeSync(descriptor); }
  if (!header.subarray(0, encryptedMagic.length).equals(encryptedMagic)) throw new Error("Encrypted backup file format is invalid");
  const saltStart = encryptedMagic.length;
  const ivStart = saltStart + encryptedSaltBytes;
  const salt = header.subarray(saltStart, ivStart);
  const iv = header.subarray(ivStart);
  const key = deriveBackupKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(source, { start: encryptedHeaderBytes, end: fileSize - encryptedTagBytes - 1 }), decipher, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
    chmodSync(destination, 0o600);
  } catch (error) {
    rmSync(destination, { force: true });
    if (String(error?.message).toLowerCase().includes("authenticate data")) throw new Error("Backup key is incorrect or encrypted file is damaged");
    throw error;
  } finally { key.fill(0); }
}

export async function backupData(source, destination) {
  if (existsSync(destination)) throw new Error("Backup destination already exists; choose a new directory");
  const sourcePath = canonicalPath(source);
  const destinationPath = canonicalPath(destination);
  if (isSameOrWithin(sourcePath, destinationPath)) throw new Error("Backup destination must be outside the source data directory");
  createPrivateDirectory(destination);
  try {
    regularFile(join(source, "barker.sqlite"));
    const database = new DatabaseSync(join(source, "barker.sqlite"), { readOnly: true });
    try { await backup(database, join(destination, "barker.sqlite")); }
    finally { database.close(); }
    sealSnapshot(join(destination, "barker.sqlite"));
    chmodSync(join(destination, "barker.sqlite"), 0o600);
    for (const name of names.slice(1)) {
      if (!existsSync(join(source, name))) continue;
      regularFile(join(source, name));
      copyFileSync(join(source, name), join(destination, name));
      chmodSync(join(destination, name), 0o600);
    }
    const version = verifyDatabase(join(destination, "barker.sqlite"));
    const files = await fileDigests(destination);
    writeFileSync(join(destination, "manifest.json"), JSON.stringify({ format: 1, schemaVersion: version, createdAt: new Date().toISOString(), files }, null, 2), { mode: 0o600 });
    chmodSync(join(destination, "manifest.json"), 0o600);
    return { files: Object.keys(files), schemaVersion: version };
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
}

export async function backupDataEncrypted(source, destination, password) {
  validateBackupKey(password);
  if (existsSync(destination)) throw new Error("Backup destination already exists; choose a new directory");
  const sourcePath = canonicalPath(source);
  const destinationPath = canonicalPath(destination);
  if (isSameOrWithin(sourcePath, destinationPath)) throw new Error("Backup destination must be outside the source data directory");
  createPrivateDirectory(destination);
  let staging;
  try {
    staging = mkdtempSync(join(tmpdir(), "rubidium-encrypted-backup-"));
    chmodSync(staging, 0o700);
    const snapshot = join(staging, "snapshot");
    const result = await backupData(source, snapshot);
    for (const name of encryptionKeyFileNames) {
      const plainFile = join(snapshot, name);
      if (existsSync(plainFile)) await encryptBackupFile(plainFile, join(destination, `${name}.enc`), password);
    }
    return { files: readdirSync(destination).sort(), schemaVersion: result.schemaVersion };
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

export async function restoreData(source, destination) {
  if (existsSync(destination)) throw new Error("Restore target must be a new data directory; existing data is never overwritten");
  const sourcePath = canonicalPath(source);
  const destinationPath = canonicalPath(destination);
  if (isSameOrWithin(sourcePath, destinationPath)) throw new Error("Restore target must be outside the backup directory");
  regularFile(join(source, "manifest.json"));
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  if (manifest.format !== 1 || !manifest.files || typeof manifest.files !== "object" || !("barker.sqlite" in manifest.files)) throw new Error("Invalid backup manifest");
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!names.includes(name)) throw new Error(`Unexpected backup file ${name}`);
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Invalid checksum in backup manifest: ${name}`);
    regularFile(join(source, name));
    if (await digest(join(source, name)) !== expected) throw new Error(`Backup checksum mismatch: ${name}`);
  }
  if (readdirSync(source).some((name) => ![...names, "manifest.json"].includes(name))) throw new Error("Backup contains unexpected files");
  createPrivateDirectory(destination);
  try {
    for (const name of Object.keys(manifest.files)) {
      copyFileSync(join(source, name), join(destination, name));
      chmodSync(join(destination, name), 0o600);
    }
    sealSnapshot(join(destination, "barker.sqlite"));
    const sourceVersion = verifyDatabase(join(destination, "barker.sqlite"));
    if (manifest.schemaVersion !== sourceVersion) throw new Error("Backup manifest schema version does not match the database");
    const database = new DatabaseSync(join(destination, "barker.sqlite"));
    try {
      for (const table of ["sessions", "api_tokens", "runtime_state"]) {
        if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) database.exec(`DELETE FROM ${table}`);
      }
    }
    finally { database.close(); }
    verifyDatabase(join(destination, "barker.sqlite"));
    const restoredFiles = await fileDigests(destination);
    writeFileSync(join(destination, "manifest.json"), JSON.stringify({
      format: 1,
      schemaVersion: sourceVersion,
      createdAt: new Date().toISOString(),
      restoredFrom: typeof manifest.createdAt === "string" ? manifest.createdAt : null,
      files: restoredFiles,
    }, null, 2), { mode: 0o600 });
    chmodSync(join(destination, "manifest.json"), 0o600);
    return { restored: true };
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
}

export async function restoreDataEncrypted(source, destination, password) {
  validateBackupKey(password);
  if (existsSync(destination)) throw new Error("Restore target must be a new data directory; existing data is never overwritten");
  const sourcePath = canonicalPath(source);
  const destinationPath = canonicalPath(destination);
  if (isSameOrWithin(sourcePath, destinationPath)) throw new Error("Restore target must be outside the encrypted backup directory");
  const files = readdirSync(source).sort();
  if (files.some((name) => !encryptedFileNames.includes(name)) || !files.includes("barker.sqlite.enc") || !files.includes("manifest.json.enc")) {
    throw new Error("Encrypted backup is missing required files or contains unexpected files");
  }
  let staging;
  try {
    staging = mkdtempSync(join(tmpdir(), "rubidium-decrypted-backup-"));
    chmodSync(staging, 0o700);
    for (const encryptedName of files) {
      const plainName = encryptedName.slice(0, -4);
      await decryptBackupFile(join(source, encryptedName), join(staging, plainName), password);
    }
    return await restoreData(staging, destination);
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  loadRuntimeEnvironment();
  const [mode, target, sourceArgument] = process.argv.slice(2);
  const modes = ["backup", "restore", "backup-encrypted", "restore-encrypted"];
  if (!modes.includes(mode) || !target) throw new Error("Usage: node scripts/data-tools.mjs backup|restore|backup-encrypted|restore-encrypted NEW_TARGET_DIR [SOURCE_DIR]");
  const source = sourceArgument ? resolve(sourceArgument) : runtimeDirectory();
  const destination = resolve(target);
  if (!existsSync(dirname(destination))) throw new Error("Target parent directory does not exist");
  const result = mode === "backup" ? await backupData(source, destination)
    : mode === "restore" ? await restoreData(source, destination)
      : mode === "backup-encrypted" ? await backupDataEncrypted(source, destination, backupKeyFromEnvironment())
        : await restoreDataEncrypted(source, destination, backupKeyFromEnvironment());
  console.log(JSON.stringify(result));
}
