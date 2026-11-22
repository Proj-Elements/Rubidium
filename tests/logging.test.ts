import assert from "node:assert/strict";
import { test } from "node:test";
import { __logSecretSourceCountForTests, logError, replaceLogSecrets, setLogSecret } from "../lib/logging";

test("log redaction follows active credential sources without retaining rotation history", (context) => {
  const prefix = "test:rotation:";
  const source = `${prefix}password`;
  const messages: string[] = [];
  context.mock.method(console, "error", (message: string) => messages.push(message));
  try {
    setLogSecret(source, "first-rotation-password");
    logError("test.before-rotation", new Error("first-rotation-password"));
    assert.doesNotMatch(messages.pop() ?? "", /first-rotation-password/);

    for (let index = 0; index < 1000; index += 1) {
      setLogSecret(source, `rotated-password-${index}`);
      assert.equal(__logSecretSourceCountForTests(prefix), 1);
    }
    logError("test.after-rotation", new Error("rotated-password-999"));
    assert.doesNotMatch(messages.pop() ?? "", /rotated-password-999/);
    logError("test.old-value", new Error("first-rotation-password"));
    assert.match(messages.pop() ?? "", /first-rotation-password/);

    setLogSecret(`${prefix}shared-device`, "shared-channel-token");
    setLogSecret(`${prefix}shared-password`, "shared-channel-token");
    setLogSecret(`${prefix}shared-password`, "current-password");
    logError("test.shared-source", new Error("shared-channel-token"));
    assert.doesNotMatch(messages.pop() ?? "", /shared-channel-token/);
    setLogSecret(`${prefix}shared-device`, null);
    logError("test.removed-source", new Error("shared-channel-token"));
    assert.match(messages.pop() ?? "", /shared-channel-token/);
  } finally {
    replaceLogSecrets(prefix, []);
  }
  assert.equal(__logSecretSourceCountForTests(prefix), 0);
});
