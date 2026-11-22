import assert from "node:assert/strict";
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
