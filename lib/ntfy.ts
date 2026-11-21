import { DeliveryError, retryAfter } from "./bark";
import { redactSecrets } from "./errors";
import type { ChannelDeliverySettings } from "./types";

export function ntfyPublishUrl(endpoint: string, topic: string): URL {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(topic)}`;
  url.search = "";
  url.hash = "";
  return url;
}

function encodedTitle(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function sendNtfy(
  settings: ChannelDeliverySettings,
  title: string,
  body: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const token = settings.deviceKey.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(ntfyPublishUrl(settings.endpoint, settings.topic), {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...((title || settings.title) ? { "x-title": encodedTitle(title || settings.title) } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const status = response.status;
      const transient = status === 408 || status === 425 || status === 429 || status >= 500;
      throw new DeliveryError(`Ntfy API 返回 HTTP ${status}`, {
        kind: transient ? "transient" : "permanent",
        status,
        retryAt: status === 429 || status === 503 ? retryAfter(response.headers.get("retry-after")) : undefined,
        scope: status === 413 ? "payload" : "endpoint",
      });
    }
    void response.body?.cancel().catch(() => undefined);
  } catch (error) {
    if (error instanceof DeliveryError) {
      error.message = redactSecrets(error.message, [token]);
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeliveryError("Ntfy API 请求超时，将自动重试", { kind: "transient" });
    }
    const detail = error instanceof Error ? redactSecrets(error.message, [token]).slice(0, 160) : "未知错误";
    throw new DeliveryError(`Ntfy API 网络错误：${detail}`, { kind: "transient" });
  } finally {
    clearTimeout(timeout);
  }
}
