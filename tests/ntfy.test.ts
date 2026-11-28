import assert from "node:assert/strict";
import { test } from "node:test";
import { BarkDeliveryError, DeliveryError } from "../lib/bark";
import { sendNotification } from "../lib/notification";
import { ntfyPublishUrl, sendNtfy } from "../lib/ntfy";
import { DEFAULT_SETTINGS, type ChannelDeliverySettings } from "../lib/types";

const ntfy: ChannelDeliverySettings = {
  ...DEFAULT_SETTINGS,
  channelType: "ntfy",
  endpoint: "https://ntfy.example/push/",
  topic: "rubidium_alerts",
  deviceKey: "private-ntfy-token",
};

const acknowledgement = () => Response.json({ id: "test-message-id", event: "message", topic: ntfy.topic });

test("Ntfy posts UTF-8 messages to the configured topic without following redirects", async () => {
  let request: { url: string; headers: Headers; body: string; redirect: RequestRedirect | undefined } | undefined;
  await sendNtfy(ntfy, "计划提醒", "内容在这里", async (url, init) => {
    request = { url: String(url), headers: new Headers(init?.headers), body: String(init?.body), redirect: init?.redirect };
    return acknowledgement();
  });
  assert.equal(request?.url, "https://ntfy.example/push/rubidium_alerts");
  assert.equal(request?.headers.get("authorization"), "Bearer private-ntfy-token");
  assert.equal(request?.headers.get("x-title"), `=?UTF-8?B?${Buffer.from("计划提醒").toString("base64")}?=`);
  assert.equal(request?.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(request?.body, "内容在这里");
  assert.equal(request?.redirect, "manual");
});

test("Ntfy supports public topics and safely appends validated topic segments", async () => {
  assert.equal(ntfyPublishUrl("https://ntfy.example/base/path/", "safe_topic-1").toString(), "https://ntfy.example/base/path/safe_topic-1");
  await sendNtfy({ ...ntfy, deviceKey: "" }, "", "Body", async (_url, init) => {
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return acknowledgement();
  });
});

test("Ntfy classifies permanent and retryable responses and honors Retry-After", async () => {
  for (const status of [400, 401, 403, 404]) {
    await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => new Response(null, { status })),
      (error: unknown) => error instanceof DeliveryError && error.kind === "permanent" && error.status === status);
  }
  await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => new Response(null, { status: 413 })),
    (error: unknown) => error instanceof DeliveryError && error.scope === "payload");
  await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => new Response(null, { status: 429, headers: { "retry-after": "3600" } })),
    (error: unknown) => error instanceof DeliveryError && error.kind === "transient" && error.status === 429 && Boolean(error.retryAt));
  await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => new Response(null, { status: 503 })),
    (error: unknown) => error instanceof DeliveryError && error.kind === "transient");
});

test("Ntfy network errors redact credentials and timeouts remain retryable", async () => {
  await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => { throw new Error(`failed ${ntfy.deviceKey}`); }), (error: unknown) => {
    assert.ok(error instanceof DeliveryError);
    assert.equal(error.kind, "transient");
    assert.equal(error.message.includes(ntfy.deviceKey), false);
    return true;
  });
  await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }), (error: unknown) => error instanceof DeliveryError && error.kind === "transient" && /超时/.test(error.message));
});

test("Ntfy requires a message acknowledgement for the requested topic", async () => {
  for (const body of ["", "<html>proxy login</html>", "{}", "null", "[]",
    JSON.stringify({ id: "message-id", event: "keepalive", topic: ntfy.topic }),
    JSON.stringify({ id: "message-id", event: "message", topic: "different-topic" }),
    JSON.stringify({ id: "", event: "message", topic: ntfy.topic }),
    JSON.stringify({ id: " ", event: "message", topic: ntfy.topic }),
    JSON.stringify({ event: "message", topic: ntfy.topic })]) {
    await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => new Response(body)),
      (error: unknown) => error instanceof DeliveryError && error.kind === "transient");
  }
});

test("Ntfy bounds acknowledgement response size", async () => {
  await assert.rejects(sendNtfy(ntfy, "Title", "Body", async () => Response.json({
    id: "message-id", event: "message", topic: ntfy.topic, padding: "x".repeat(17_000),
  })), /响应过大/);
});

test("Ntfy waits for its acknowledgement and times out a stalled response", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = sendNtfy(ntfy, "Title", "Body", async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    },
  })));
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof DeliveryError && error.kind === "transient" && /超时/.test(error.message));
  await Promise.resolve();
  context.mock.timers.tick(15_000);
  await rejected;
});

test("channel dispatcher preserves the existing Bark adapter", async () => {
  await sendNotification(ntfy, "Ntfy title", "Ntfy body", async (url, init) => {
    assert.equal(String(url), "https://ntfy.example/push/rubidium_alerts");
    assert.equal(String(init?.body), "Ntfy body");
    return acknowledgement();
  });
  await sendNotification({ ...ntfy, channelType: "bark", endpoint: "https://bark.example", deviceKey: "bark-key" }, "Bark title", "Bark body", async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).title, "Bark title");
    return Response.json({ code: 200 });
  });
  assert.ok(new BarkDeliveryError("legacy").name === "BarkDeliveryError");
});
