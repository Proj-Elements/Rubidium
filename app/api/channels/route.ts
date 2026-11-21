import { NextResponse } from "next/server";
import { z } from "zod";
import { requestIsAuthorized } from "@/lib/auth";
import { listChannels, removeChannel, saveChannel } from "@/lib/db";
import { channelInputSchema } from "@/lib/validation";
import { apiRoute, expectedRevision, jsonError, requestBody, requireSameOriginMutation, validationMessage } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channelRequestSchema = z.intersection(channelInputSchema, z.object({
  id: z.string().trim().min(1, "渠道 ID 不能为空").max(100).optional(),
  revision: z.number().int().positive().optional(),
  clearCredential: z.boolean().optional(),
})).superRefine((value, context) => {
  if (value.clearCredential && value.credential) context.addIssue({ code: "custom", path: ["credential"], message: "不能同时清除并填写渠道凭据" });
});

export const GET = apiRoute(async (request: Request): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  return NextResponse.json({ channels: listChannels() });
});

export const POST = apiRoute(async (request: Request): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const result = channelRequestSchema.safeParse(await requestBody(request));
  if (!result.success) return jsonError(validationMessage(result.error), 400);
  if (result.data.id || result.data.revision !== undefined || result.data.clearCredential) return jsonError("创建渠道不能包含 ID、修订号或清除凭据标记", 400);
  const { name, type, endpoint, topic, credential } = result.data;
  return NextResponse.json({ channel: saveChannel({ name, type, endpoint, topic, credential }) }, { status: 201 });
});

export const PUT = apiRoute(async (request: Request): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const result = channelRequestSchema.safeParse(await requestBody(request));
  if (!result.success) return jsonError(validationMessage(result.error), 400);
  if (!result.data.id) return jsonError("更新渠道必须包含 ID", 400);
  const revision = expectedRevision(result.data.revision);
  return NextResponse.json({ channel: saveChannel({ ...result.data, revision }) });
});

export const DELETE = apiRoute(async (request: Request): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  removeChannel(id, expectedRevision(Number(request.headers.get("if-match"))));
  return NextResponse.json({ deleted: true });
});
