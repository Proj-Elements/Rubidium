import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { backup, DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCookieValue, isValidSessionToken } from "@/lib/auth";
import { encryptExport, MAX_TRANSFER_BYTES } from "@/lib/data-transfer";
import { connection } from "@/lib/db/core";
import { DomainError } from "@/lib/errors";
import { apiRoute, jsonError, requestBody, requireSameOriginMutation, validationMessage } from "@/lib/http";
import { privateFile, runtimeDataDir } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ passphrase: z.string().min(1).max(200) }).strict();

async function createExportSnapshot(): Promise<Buffer> {
  const directory = mkdtempSync(join(runtimeDataDir, ".rubidium-export-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "snapshot.sqlite");
  try {
    await backup(connection(), path);
    privateFile(path);
    const snapshot = new DatabaseSync(path);
    try {
      snapshot.exec("PRAGMA secure_delete=ON");
      snapshot.exec("DELETE FROM sessions; DELETE FROM api_tokens; DELETE FROM settings WHERE key IN ('password_override', 'password_revision')");
      snapshot.exec("VACUUM");
    } finally {
      snapshot.close();
    }
    privateFile(path);
    if (statSync(path).size > MAX_TRANSFER_BYTES) throw new DomainError("数据快照超过 40 MiB 导出限制", 413);
    return readFileSync(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export const POST = apiRoute(async (request: Request) => {
  if (!isValidSessionToken(getCookieValue(request.headers.get("cookie")))) return jsonError("请使用浏览器会话导出数据", 401);
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const result = schema.safeParse(await requestBody(request));
  if (!result.success) return jsonError(validationMessage(result.error), 400);
  const snapshot = await createExportSnapshot();
  const envelope = encryptExport(snapshot, result.data.passphrase);
  return NextResponse.json(envelope, { headers: { "cache-control": "no-store" } });
});
