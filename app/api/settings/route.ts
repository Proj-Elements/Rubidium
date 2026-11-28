import { NextResponse } from "next/server";
import { requestIsAuthorized } from "@/lib/auth";
import { dataDirectory, readSettingsState, writeSettings } from "@/lib/db";
import { apiRoute, expectedRevision, jsonError, jsonObjectBody, requestBody, requireSameOriginMutation, validationMessage } from "@/lib/http";
import { settingsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  const state = readSettingsState();
  // Only the absolute data directory is exposed, never any stored secret.
  return NextResponse.json({ ...state, dataDir: dataDirectory() });
});

export const PUT = apiRoute(async (request: Request): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const data = jsonObjectBody(await requestBody(request));
  const { revision: suppliedRevision, ...candidate } = data;
  const revision = expectedRevision(suppliedRevision);
  const result = settingsSchema.safeParse(candidate);
  if (!result.success) return jsonError(validationMessage(result.error), 400);
  const nextRevision = writeSettings(result.data, revision);
  return NextResponse.json({ saved: true, revision: nextRevision });
});
