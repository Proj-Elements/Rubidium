import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordValidationMessage } from "../lib/password-policy";

test("password policy reports actionable length and whitespace reasons", () => {
  assert.match(passwordValidationMessage("short") ?? "", /至少需要 8 个字符（当前 5 个）/);
  assert.match(passwordValidationMessage(" leading-space") ?? "", /不能以空格开头或结尾/);
  assert.match(passwordValidationMessage("trailing-space ") ?? "", /不能以空格开头或结尾/);
  assert.equal(passwordValidationMessage("valid-pass"), null);
  assert.match(passwordValidationMessage("a".repeat(301)) ?? "", /最多 300 个字符/);
});
