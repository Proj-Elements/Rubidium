import { NextResponse } from "next/server";
import { requestIsAuthorized } from "@/lib/auth";
import { DeliveryError } from "@/lib/bark";
import { deliverySettings } from "@/lib/db";
import { redactSecrets } from "@/lib/errors";
import { apiRoute, jsonError, jsonObjectBody, requestBody, requireSameOriginMutation } from "@/lib/http";
import { sendNotification } from "@/lib/notification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = apiRoute(async (request: Request, context: RouteContext): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  jsonObjectBody(await requestBody(request));
  const { id } = await context.params;
  const settings = deliverySettings(id);
  if (settings.channelType === "bark" && !settings.deviceKey.trim()) return jsonError("尚未配置 Bark Device Key", 400);
  try {
    await sendNotification(settings, "Rubidium 渠道测试", "此消息用于检查该通知渠道的连接。");
    return NextResponse.json({ delivered: true });
  } catch (error) {
    if (!(error instanceof DeliveryError)) throw error;
    const secret = settings.deviceKey;
    const message = settings.channelType === "bark" ? redactSecrets(error.message, [secret]) : error.message;
    return jsonError(message, 502);
  }
});
