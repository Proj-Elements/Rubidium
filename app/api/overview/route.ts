import { NextResponse } from "next/server";
import { requestIsAuthorized } from "@/lib/auth";
import { activeScheduleTasks, dashboardStats, deliverySummary, listChannels, readSettings, recentDeliveries, tasksByIds } from "@/lib/db";
import { apiRoute, jsonError } from "@/lib/http";
import { FORECAST_BUDGET_MS, upcomingWeekDetails } from "@/lib/cron";
import { logError } from "@/lib/logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request): Promise<NextResponse> => {
  if (!requestIsAuthorized(request)) return jsonError("未授权", 401);
  const { displayTimeZone } = readSettings();
  const defaultChannel = listChannels()[0];
  const now = new Date();
  const active = activeScheduleTasks();
  const forecast = upcomingWeekDetails(active, now, {
    timeZone: displayTimeZone, deadline: performance.now() + FORECAST_BUDGET_MS,
    onTaskError: (error, taskId) => logError("forecast.task.failed", error, { taskId }),
  });
  const ids = new Set(forecast.upcoming.map((item) => item.taskId));
  const next = active[0];
  if (next) ids.add(next.id);
  const tasks = tasksByIds(ids);
  return NextResponse.json({
    tasks,
    ...forecast,
    displayTimeZone,
    defaultChannel: { type: defaultChannel.type, credentialConfigured: defaultChannel.credentialConfigured },
    deliveries: deliverySummary(),
    ...dashboardStats(now, displayTimeZone),
    recent: recentDeliveries(),
    serverTime: now.toISOString(),
  });
});
