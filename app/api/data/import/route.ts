import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCookieValue, isValidSessionToken } from "@/lib/auth";
import { decryptExport, importDatabaseSnapshot, MAX_IMPORT_BODY_BYTES } from "@/lib/data-transfer";
import { apiRoute, jsonError, requestBody, requireSameOriginMutation, validationMessage } from "@/lib/http";
import { privateFile, runtimeDataDir } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ passphrase: z.string().min(1).max(200), envelope: z.unknown() }).strict();

export const POST = apiRoute(async (request: Request) => {
  if (!isValidSessionToken(getCookieValue(request.headers.get("cookie")))) return jsonError("请使用浏览器会话导入数据", 401);
  const blocked = requireSameOriginMutation(request, MAX_IMPORT_BODY_BYTES);
  if (blocked) return blocked;
  const result = schema.safeParse(await requestBody(request, MAX_IMPORT_BODY_BYTES));
  if (!result.success) return jsonError(validationMessage(result.error), 400);

  const snapshot = decryptExport(result.data.envelope, result.data.passphrase);
  const directory = mkdtempSync(join(runtimeDataDir, ".rubidium-import-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "snapshot.sqlite");
  try {
    writeFileSync(path, snapshot, { flag: "wx", mode: 0o600 });
    privateFile(path);
    importDatabaseSnapshot(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return NextResponse.json({ imported: true }, { headers: { "cache-control": "no-store" } });
});
