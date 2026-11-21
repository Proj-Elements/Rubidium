import { sendBark } from "./bark";
import { sendNtfy } from "./ntfy";
import type { ChannelDeliverySettings } from "./types";

export function sendNotification(
  settings: ChannelDeliverySettings,
  title: string,
  body: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (settings.channelType === "ntfy") return sendNtfy(settings, title, body, fetcher);
  return sendBark(settings, title, body, fetcher);
}
