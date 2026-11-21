import { NextResponse } from "next/server";
import { clearSessionCookie, clientKeyFor, createSessionToken, getCookieValue, initializePassword, loginRetryAfter, MAX_SECRET_LENGTH, passwordIsConfigured, revokeSessionToken, requestIsAuthorized, requestUsesHttps, setSessionCookie, verifyPassword } from "@/lib/auth";
import { apiRoute, jsonError, jsonObjectBody, requestBody, requireSameOriginMutation } from "@/lib/http";

export const runtime = "nodejs";

export const GET = apiRoute(async (request: Request): Promise<NextResponse> => {
  return NextResponse.json({ authenticated: requestIsAuthorized(request), initialized: passwordIsConfigured() });
});

export const POST = apiRoute(async (request: Request): Promise<NextResponse> => {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const { password, mode, timeZone } = jsonObjectBody(await requestBody(request));
  if (typeof password !== "string") return jsonError("请输入访问密码", 400);
  if (password.length > MAX_SECRET_LENGTH) return jsonError("访问密码过长", 400);
  if (mode !== undefined && mode !== "login" && mode !== "setup") return jsonError("初始化请求无效", 400);
  if (mode === "setup") {
    if (passwordIsConfigured()) return jsonError("初始化已完成，请刷新页面后登录", 409);
    if (timeZone !== undefined && typeof timeZone !== "string") return jsonError("时区无效", 400);
    if (!initializePassword(password, timeZone)) return jsonError("初始化已由其他请求完成，请刷新页面后登录", 409);
  } else {
    if (!passwordIsConfigured()) return jsonError("请先创建访问密码", 428);
  }
  const clientKey = clientKeyFor(request);
  const now = Date.now();
  if (mode !== "setup" && !verifyPassword(password, now, clientKey)) {
    const wait = loginRetryAfter(clientKey, now);
    const response = jsonError(wait ? "错误尝试次数过多，请稍后再试" : "访问密码错误", wait ? 429 : 401);
    if (wait) response.headers.set("retry-after", String(wait));
    return response;
  }
  const response = NextResponse.json({ authenticated: true });
  response.headers.set("set-cookie", setSessionCookie(createSessionToken(), requestUsesHttps(request)));
  return response;
});

export const DELETE = apiRoute(async (request: Request): Promise<NextResponse> => {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const response = NextResponse.json({ authenticated: false });
  revokeSessionToken(getCookieValue(request.headers.get("cookie")));
  response.headers.set("set-cookie", clearSessionCookie(requestUsesHttps(request)));
  return response;
});
