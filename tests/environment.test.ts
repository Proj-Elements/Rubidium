import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getEnvironmentVariable } from "../lib/environment.mjs";

test("new environment names take priority over legacy aliases", () => {
  assert.equal(getEnvironmentVariable("PASSWORD", {
    RUBIDIUM_PASSWORD: "current-password",
    BARKER_PASSWORD: "legacy-password",
  }), "current-password");
  assert.equal(getEnvironmentVariable("PASSWORD", {
    RUBIDIUM_PASSWORD: "",
    BARKER_PASSWORD: "legacy-password",
  }), "");
});

test("legacy environment names remain accepted when the new name is absent", () => {
  assert.equal(getEnvironmentVariable("DATA_DIR", { BARKER_DATA_DIR: "/legacy/data" }), "/legacy/data");
  assert.equal(getEnvironmentVariable("DATA_DIR", {}), undefined);
});

test("runtime paths reject symlinks into build output, including nonexistent descendants", async () => {
  const { runtimeDirectory } = await import(new URL("../scripts/runtime-paths.mjs", import.meta.url).href);
  const root = mkdtempSync(join(tmpdir(), "rubidium-runtime-paths-"));
  try {
    const unsafe = join(root, ".next", "cache");
    mkdirSync(unsafe, { recursive: true });
    symlinkSync(unsafe, join(root, "linked-data"));
    for (const configured of [".next/cache", "linked-data", "linked-data/new/data"]) {
      assert.throws(() => runtimeDirectory(root, configured), /outside \.next/);
    }
    assert.equal(existsSync(join(unsafe, "new")), false);
    mkdirSync(join(root, "safe"));
    symlinkSync(join(root, "safe"), join(root, "safe-link"));
    assert.equal(runtimeDirectory(root, "safe-link/new/data"), join(root, "safe-link/new/data"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("storage initialization rejects build-output aliases before creating or chmodding data", () => {
  const root = mkdtempSync(join(tmpdir(), "rubidium-storage-paths-"));
  try {
    const unsafe = join(root, ".next", "cache");
    mkdirSync(unsafe, { recursive: true, mode: 0o755 });
    const originalMode = statSync(unsafe).mode;
    const alias = join(root, "linked-data");
    symlinkSync(unsafe, alias);
    const storageUrl = new URL("../lib/storage.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      const { initializeStorage } = await import(${JSON.stringify(storageUrl)});
      initializeStorage();
    `], { env: { ...process.env, RUBIDIUM_DATA_DIR: alias }, encoding: "utf8", timeout: 10_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside \.next/);
    assert.equal(statSync(unsafe).mode, originalMode);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("build preflight checks the data directory configured in local environment files", async () => {
  const { checkLegacyData } = await import(new URL("../scripts/runtime-paths.mjs", import.meta.url).href);
  const root = mkdtempSync(join(tmpdir(), "rubidium-preflight-paths-"));
  const previousData = process.env.RUBIDIUM_DATA_DIR;
  const previousLegacyData = process.env.BARKER_DATA_DIR;
  delete process.env.RUBIDIUM_DATA_DIR;
  delete process.env.BARKER_DATA_DIR;
  try {
    const unsafe = join(root, ".next", "cache");
    mkdirSync(unsafe, { recursive: true });
    symlinkSync(unsafe, join(root, "linked-data"));
    writeFileSync(join(root, ".env.local"), "RUBIDIUM_DATA_DIR=linked-data\n", { mode: 0o600 });
    assert.throws(() => checkLegacyData(root), /outside \.next/);
  } finally {
    if (previousData === undefined) delete process.env.RUBIDIUM_DATA_DIR;
    else process.env.RUBIDIUM_DATA_DIR = previousData;
    if (previousLegacyData === undefined) delete process.env.BARKER_DATA_DIR;
    else process.env.BARKER_DATA_DIR = previousLegacyData;
    rmSync(root, { recursive: true, force: true });
  }
});
