import { expect, test, type Page } from "@playwright/test";
import { parseDate } from "@internationalized/date";
import { localDateValue } from "../../lib/ui";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
  const listing = await (await page.request.get("/api/tasks")).json();
  for (const task of listing.tasks) {
    if (task.status !== "archived") await page.request.delete(`/api/tasks/${task.id}`, { headers: { "if-match": String(task.revision) } });
    const current = (await (await page.request.get("/api/tasks?status=archived&page=1&pageSize=50")).json()).tasks.find((item: { id: string }) => item.id === task.id);
    if (current) await page.request.delete(`/api/tasks/${task.id}?permanent=1`, { headers: { "if-match": String(current.revision) } });
  }
}

test("production HTML uses a fresh nonce for its inline scripts", async ({ page }) => {
  const readNonce = async () => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    const policy = await response?.headerValue("content-security-policy");
    const scripts = policy?.split("; ").find((directive) => directive.startsWith("script-src ")) ?? "";
    const nonce = scripts.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    const inlineNonces = await page.locator("script:not([src])").evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).nonce));
    expect(inlineNonces.length).toBeGreaterThan(0);
    expect([...new Set(inlineNonces)]).toEqual([nonce]);
    return nonce;
  };
  const first = await readNonce();
  expect(await readNonce()).not.toBe(first);
  await login(page);
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "所有提醒", exact: true }).click();
  await expect(page.getByRole("heading", { name: /所有提醒/ })).toBeVisible();
});

test("mobile overview prioritizes the next reminder and unsaved settings protect navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const date = localDateValue(new Date(Date.now() + 2 * 86_400_000));
  expect((await page.request.post("/api/tasks", { data: {
    name: "喝杯水，休息一下", description: "起身活动，让眼睛离开屏幕。", startsAt: `${date}T09:00:00+08:00`, preset: "daily", cron: "0 9 * * *", repeatCount: 2, endDate: null,
  } })).status()).toBe(201);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "下一条提醒", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "喝杯水，休息一下", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("mobile-overview.png"), fullPage: true, animations: "disabled" });

  for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const nextCard = page.locator(".overview-next");
    const metrics = page.getByRole("region", { name: "提醒指标" });
    const warning = page.locator(".overview-device-warning");
    await expect(nextCard.getByRole("heading", { name: "下一条提醒", exact: true })).toBeInViewport();
    await expect(page.getByRole("heading", { name: "喝杯水，休息一下", exact: true })).toBeInViewport();
    const nextBounds = await nextCard.boundingBox();
    const metricsBounds = await metrics.boundingBox();
    const warningBounds = await warning.boundingBox();
    expect(nextBounds).not.toBeNull();
    expect(metricsBounds).not.toBeNull();
    expect(warningBounds).not.toBeNull();
    expect(metricsBounds!.y).toBeGreaterThanOrEqual(nextBounds!.y + nextBounds!.height);
    expect(warningBounds!.y).toBeGreaterThanOrEqual(metricsBounds!.y + metricsBounds!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`landscape-overview-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "工作空间导航" })).toBeInViewport({ ratio: 1 });
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "推送设置", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: "关闭导航", exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "更多通知选项", exact: true }).click();
  await page.getByLabel("默认通知分组", { exact: true }).fill("Unsaved navigation draft");
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "投递记录", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "投递记录", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "离开页面" }).click();
  await expect(page).toHaveURL(/\/deliveries$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /投递状态/ })).toHaveText("全部记录");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("mobile-deliveries.png"), fullPage: true, animations: "disabled" });
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "编辑 喝杯水，休息一下", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("mobile-tasks.png"), fullPage: true, animations: "disabled" });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "通知渠道", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("mobile-settings.png"), fullPage: true, animations: "disabled" });
});

test("browser Back preserves dirty settings when leaving is rejected", async ({ page }) => {
  await login(page);
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "所有提醒", exact: true }).click();
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "推送设置", exact: true }).click();
  await page.getByRole("button", { name: "更多通知选项", exact: true }).click();
  await page.getByLabel("默认通知分组", { exact: true }).fill("History draft");
  await page.evaluate(() => history.back());
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByLabel("默认通知分组", { exact: true })).toHaveValue("History draft");
  await page.evaluate(() => history.back());
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "离开页面" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
});

test("settings only poll the active panel and preserve notification preference drafts in landscape", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await login(page);
  const originalRetentionDays = (await (await page.request.get("/api/settings")).json()).settings.historyRetentionDays;
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["/api/settings", "/api/channels", "/api/devices", "/api/security", "/api/audit"].includes(path) && request.method() === "GET") requests.push(path);
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "通知渠道", exact: true })).toBeVisible();
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  const count = (path: string) => requests.filter((requestPath) => requestPath === path).length;
  expect(count("/api/devices")).toBe(0);
  await expect.poll(() => count("/api/channels")).toBe(1);
  await expect.poll(() => count("/api/settings")).toBe(1);
  expect(count("/api/security")).toBe(0);
  expect(count("/api/audit")).toBe(0);

  await page.getByRole("button", { name: "更多通知选项" }).click();
  const group = page.getByLabel("默认通知分组", { exact: true });
  await group.fill("Landscape Draft");
  await tab("访问安全").click();
  await expect.poll(() => count("/api/security")).toBe(1);
  await tab("记录维护").click();
  await expect.poll(() => count("/api/audit")).toBe(1);
  await tab("通知渠道").click();
  await expect(group).toHaveValue("Landscape Draft");
  await tab("访问安全").click();
  await expect.poll(() => count("/api/security")).toBe(2);

  const channelRequests = count("/api/channels");
  const settingsRequests = count("/api/settings");
  const deviceRequests = count("/api/devices");
  const auditRequests = count("/api/audit");
  await page.waitForTimeout(15_500);
  expect(count("/api/channels")).toBe(channelRequests);
  expect(count("/api/settings")).toBe(settingsRequests);
  expect(count("/api/devices")).toBe(deviceRequests);
  expect(count("/api/audit")).toBe(auditRequests);

  await tab("通知渠道").click();
  await expect.poll(() => count("/api/channels")).toBe(channelRequests + 1);
  await expect.poll(() => count("/api/settings")).toBe(settingsRequests + 1);
  await tab("记录维护").click();
  await expect.poll(() => count("/api/audit")).toBe(auditRequests + 1);
  expect(count("/api/settings")).toBe(settingsRequests + 1);
  const retentionField = page.getByRole("textbox", { name: /自动保留天数（0 关闭）/ });
  await expect(retentionField).toHaveValue("0");
  const retentionControl = retentionField.locator("xpath=ancestor::*[contains(@class, 'number-field__group')][1]");
  expect((await retentionControl.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const saveRetention = page.getByRole("button", { name: "保存保留策略" });
  const retentionBounds = await retentionControl.boundingBox();
  const saveBounds = await saveRetention.boundingBox();
  expect(retentionBounds).not.toBeNull();
  expect(saveBounds).not.toBeNull();
  expect(Math.abs(retentionBounds!.y + retentionBounds!.height - saveBounds!.y - saveBounds!.height)).toBeLessThanOrEqual(2);
  expect(saveBounds!.x - retentionBounds!.x - retentionBounds!.width).toBeLessThan(240);
  await expect(saveRetention).toBeDisabled();
  await retentionField.focus();
  await expect(saveRetention).toBeEnabled();
  await retentionField.fill("45");
  await saveRetention.click();
  await expect(page.getByText("保留策略已保存。", { exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/settings")).json()).settings.historyRetentionDays).toBe(45);
  await page.screenshot({ path: test.info().outputPath("settings-history-landscape-viewport.png"), animations: "disabled" });
  await page.screenshot({ path: test.info().outputPath("settings-history-landscape.png"), fullPage: true, animations: "disabled" });

  const latest = await (await page.request.get("/api/settings")).json();
  await page.request.put("/api/settings", { data: { ...latest.settings, historyRetentionDays: originalRetentionDays, revision: latest.revision } });
});

test("a first-load API error replaces the loading state and offers retry", async ({ page }) => {
  await login(page);
  let fail = true;
  await page.route((url) => new URL(url).pathname === "/api/tasks", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary failure" }) });
      return;
    }
    await route.continue();
  });
  await page.goto("/tasks");
  await expect(page.locator(".notice-error")).toContainText("Temporary failure");
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".empty-state")).toBeVisible();
});

test("task edits made during save stay open and save against the new revision", async ({ page }) => {
  await login(page);
  const response = await page.request.post("/api/tasks", { data: { name: "Race edit", startsAt: "2030-11-04T09:00:00+08:00", preset: "daily", cron: "0 9 * * *", repeatCount: 2 } });
  const { task } = await response.json();
  await page.goto("/tasks");
  await page.getByRole("button", { name: "编辑 Race edit", exact: true }).click();
  await page.getByLabel("提醒名称", { exact: true }).fill("Submitted title");
  let release!: () => void;
  let begun!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { begun = resolve; });
  await page.route(`**/api/tasks/${task.id}`, async (route) => { begun(); await held; await route.continue(); });
  try {
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await started;
    await page.getByLabel("提醒名称", { exact: true }).fill("New local title");
    release();
    await expect(page.getByText(/保存期间的新修改仍保留/)).toBeVisible();
    await expect(page.getByLabel("提醒名称", { exact: true })).toHaveValue("New local title");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.getByRole("heading", { name: "编辑提醒", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "编辑 New local title", exact: true })).toBeVisible();
  } finally { release(); }
});

test("complete agenda shows the fifth occurrence instead of linking to tasks", async ({ page }) => {
  await login(page);
  const date = localDateValue(new Date(Date.now() + 86_400_000));
  await page.request.post("/api/tasks", { data: { name: "Complete agenda", startsAt: `${date}T09:00:00+08:00`, preset: "custom", cron: "* * * * *", repeatCount: 5 } });
  await page.goto("/");
  await page.getByRole("button", { name: "查看完整排期" }).click();
  await expect(page.getByRole("dialog").getByText("Complete agenda", { exact: true })).toHaveCount(5);
});

test("copying and editing a weekly task preserves its weekday and wall clock", async ({ page }) => {
  await login(page);
  const response = await page.request.post("/api/tasks", { data: {
    name: "Monday review", description: "Original", startsAt: "2030-11-04T09:30:00+08:00", timeZone: "Asia/Shanghai",
    preset: "weekly", cron: "30 9 * * 1", repeatCount: 4, endDate: null,
  } });
  expect(response.status()).toBe(201);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "更多操作 Monday review", exact: true }).click();
  await page.getByRole("menuitem", { name: "复制为新提醒" }).click();
  await expect(page.getByRole("heading", { name: "复制为新提醒" })).toBeVisible();
  await page.getByRole("button", { name: /排期预览/ }).click();
  await expect(page.getByRole("dialog", { name: "接下来的提醒" }).locator("code")).toHaveText("30 9 * * 1");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "复制为新提醒", exact: true }).getByRole("button", { name: "新建提醒", exact: true }).click();
  await expect(page.getByRole("heading", { name: "复制为新提醒" })).toBeHidden();
  await page.getByRole("button", { name: "编辑 Monday review（副本）", exact: true }).click();
  await page.getByLabel(/^提醒内容/).fill("Edited content");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑提醒", exact: true })).toBeHidden();
  const { tasks } = await (await page.request.get("/api/tasks")).json();
  expect(tasks.find((task: { name: string }) => task.name === "Monday review（副本）")).toMatchObject({ cron: "30 9 * * 1", description: "Edited content" });
  expect(tasks.find((task: { name: string }) => task.name === "Monday review").description).toBe("Original");
});

test("copying an expired cutoff picks a fresh date in the task timezone", async ({ page }) => {
  await login(page);
  const timeZone = "Pacific/Auckland";
  const startsAt = new Date(Date.now() + 86_400_000);
  startsAt.setUTCMinutes(0, 0, 0);
  startsAt.setUTCHours(20);
  const endDate = localDateValue(new Date(startsAt.getTime() + 86_400_000), timeZone);
  const response = await page.request.post("/api/tasks", { data: {
    name: "Limited reminder", startsAt: startsAt.toISOString(), timeZone, preset: "custom", cron: "0 * * * *", endDate,
  } });
  expect(response.status()).toBe(201);

  const browserNow = new Date(startsAt.getTime() + 3 * 86_400_000);
  await page.clock.setFixedTime(browserNow);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "更多操作 Limited reminder", exact: true }).click();
  const preview = page.waitForRequest((request) => request.url().endsWith("/api/tasks/preview") && request.method() === "POST");
  await page.getByRole("menuitem", { name: "复制为新提醒" }).click();
  const expected = parseDate(localDateValue(browserNow, timeZone)).add({ days: 30 }).toString();
  expect((await preview).postDataJSON()).toMatchObject({ timeZone, endDate: expected });
});

test("a stale settings draft cannot overwrite a newer saved configuration", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const initial = await (await page.request.get("/api/settings")).json();
  await page.getByRole("button", { name: "更多通知选项", exact: true }).click();
  await page.getByLabel("默认通知分组", { exact: true }).fill("Older tab edits");
  const updated = await page.request.put("/api/settings", {
    data: { ...initial.settings, revision: initial.revision, group: "Latest configuration" },
  });
  expect(updated.status()).toBe(200);
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "设置已在其他页面更新" })).toBeVisible();
  await expect(page.getByLabel("默认通知分组", { exact: true })).toHaveValue("Older tab edits");
  const actual = await (await page.request.get("/api/settings")).json();
  expect(actual.settings.group).toBe("Latest configuration");
});

test("clearing a configured Bark credential requires an empty replacement field", async ({ page }) => {
  await login(page);
  const before = (await (await page.request.get("/api/channels")).json()).channels[0];
  const saved = await page.request.put("/api/channels", { data: { ...before, credential: "browser-connected-key" } });
  expect(saved.status()).toBe(200);
  await page.goto("/settings");
  await page.getByRole("button", { name: "编辑 主要通知", exact: true }).click();
  const key = page.getByLabel("Device Key", { exact: true });
  await key.fill("unsaved-key");
  const clear = page.getByRole("button", { name: "清除已保存凭据", exact: true });
  await expect(clear).toBeDisabled();
  await key.fill("");
  await clear.click();
  await expect(key).toHaveValue("");
  await page.getByRole("button", { name: "保存渠道", exact: true }).click();
  await expect(page.getByText("未配置密钥", { exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/channels")).json()).channels[0].credentialConfigured).toBe(false);
});

test("calendar overflow is visible and overview remains usable on desktop", async ({ page }) => {
  await login(page);
  const date = localDateValue(new Date(Date.now() + 86_400_000));
  const response = await page.request.post("/api/tasks", { data: {
    name: "Busy morning", startsAt: `${date}T09:00:00+08:00`, preset: "custom", cron: "* * * * *", repeatCount: 5, endDate: null,
  } });
  expect(response.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("radio", { name: /，5 条$/ }).click();
  await expect(page.locator(".upcoming-row")).toHaveCount(4);
  await expect(page.getByText("当天共 5 条，另有 1 条未展开。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("desktop-overview.png"), fullPage: true, animations: "disabled" });
});

test("home reminder names truncate without overflow and open complete read-only details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const longName = "ReminderWithoutAnySpacesForTruncation".repeat(3).slice(0, 80);
  const recentLongName = "RecentDeliveryTitleWithoutBreaks".repeat(3);
  const date = localDateValue(new Date(Date.now() + 86_400_000));
  const skippedDate = localDateValue(new Date(Date.now() + 3 * 86_400_000));
  const additionalDate = localDateValue(new Date(Date.now() + 4 * 86_400_000));
  const created = await page.request.post("/api/tasks", { data: {
    name: longName, description: "Reminder detail content for the read-only view.", startsAt: `${date}T09:00:00+08:00`, preset: "weekdays", cron: "0 9 * * 1-5", repeatCount: 2,
    endDate: null, timeZone: "Asia/Shanghai", maxLatenessMinutes: 30, deviceId: "default",
    notification: { sound: "alarm", group: "browser regression", icon: "https://example.test/icon.png" }, skipDates: [skippedDate], includeDates: [additionalDate],
  } });
  expect(created.status()).toBe(201);
  const task = (await created.json()).task as { id: string };
  await page.route("**/api/overview", async (route) => {
    const response = await route.fetch();
    const overview = await response.json();
    const stamp = new Date().toISOString();
    overview.recent = [{
      id: "overview-long-title-delivery", taskId: task.id, taskName: recentLongName, description: "Recent delivery preview", deviceId: "default", manualOnly: false,
      occurrenceAt: stamp, status: "sent", attempts: 1, lastError: null, nextAttemptAt: stamp, deliveredAt: stamp, createdAt: stamp, updatedAt: stamp, expiresAt: null,
    }];
    await route.fulfill({ response, json: overview });
  });
  await page.goto("/");

  const upcomingRow = page.locator(".upcoming-row").filter({ hasText: longName }).first();
  await expect(upcomingRow).toBeVisible();
  await expect(upcomingRow).toHaveCSS("border-radius", "0px");
  await expect(upcomingRow.locator(".upcoming-title")).toHaveAttribute("title", longName);
  await expect(upcomingRow.locator(".upcoming-title")).toHaveCSS("text-overflow", "ellipsis");
  await expect(page.locator(".recent-delivery-title")).toHaveAttribute("title", recentLongName);
  await expect(page.locator(".recent-delivery-title")).toHaveCSS("text-overflow", "ellipsis");
  await page.getByRole("button", { name: `查看提醒详情：${longName}`, exact: true }).click();
  const mainDetails = page.getByRole("dialog", { name: "提醒详情" });
  await expect(mainDetails).toBeVisible();
  await mainDetails.getByRole("button", { name: "关闭提醒详情", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("mobile-overview-long-names.png"), fullPage: true, animations: "disabled" });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    elements: [...document.querySelectorAll<HTMLElement>("body *")].map((element) => {
      const bounds = element.getBoundingClientRect();
      return { tag: element.tagName, className: element.className, left: Math.round(bounds.left), right: Math.round(bounds.right), width: Math.round(bounds.width), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    }).filter((element) => element.right > innerWidth + 1 || element.left < -1).slice(0, 20),
  }));
  if (overflow.scrollWidth > overflow.viewportWidth) console.info("overview horizontal overflow", JSON.stringify(overflow));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewportWidth);
  const rowBounds = await upcomingRow.boundingBox();
  expect(rowBounds).not.toBeNull();
  expect(rowBounds!.x + rowBounds!.width).toBeLessThanOrEqual(391);
  await upcomingRow.click();
  const dialog = page.getByRole("dialog", { name: "提醒详情" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(longName, { exact: true })).toBeVisible();
  await expect(dialog.getByText("Reminder detail content for the read-only view.", { exact: true })).toBeVisible();
  for (const label of ["排期", "通知设置", "投递统计", "记录信息", "Cron 表达式", "时区", "通知渠道", "渠道地址", "提示音", "通知分组", "图标地址", "跳过日期", "额外日期", "创建时间", "更新时间"]) {
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText("Asia/Shanghai", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("mobile-reminder-details.png"), fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "编辑提醒", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "提醒名称" })).toHaveValue(longName);
});

test("archived reminders can be selected and permanently deleted in bulk", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const taskNames = ["Bulk archived one", "Bulk archived two", "Bulk active stays"];
  const created: Array<{ id: string; revision: number }> = [];
  for (const name of taskNames) {
    const response = await page.request.post("/api/tasks", { data: { name, startsAt: "2035-01-01T09:00:00+08:00", preset: "daily", cron: "0 9 * * *", repeatCount: 3 } });
    expect(response.status()).toBe(201);
    created.push(await response.json().then((result) => result.task));
  }
  for (const task of created.slice(0, 2)) {
    expect((await page.request.delete(`/api/tasks/${task.id}`, { headers: { "if-match": String(task.revision) } })).status()).toBe(200);
  }

  await page.goto("/tasks?status=active");
  await expect(page.getByRole("row", { name: taskNames[2] })).toBeVisible();
  await page.getByRole("checkbox", { name: "选择本页提醒" }).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByRole("toolbar", { name: "批量操作" }).getByRole("button", { name: "删除所选项", exact: true })).toHaveCount(0);

  await page.goto("/tasks?status=archived");
  await expect(page.getByRole("row", { name: /Bulk archived one/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Bulk archived two/ })).toBeVisible();
  await page.getByRole("checkbox", { name: "选择本页提醒" }).locator("xpath=ancestor::label[1]").click();
  const bulkDelete = page.getByRole("toolbar", { name: "批量操作" }).getByRole("button", { name: "删除所选项", exact: true });
  await expect(bulkDelete).toBeVisible();
  await bulkDelete.click();
  const confirmation = page.getByRole("alertdialog", { name: /永久删除选中的 2 条归档提醒/ });
  await expect(confirmation).toContainText("永久删除选中的 2 条归档提醒");
  await confirmation.getByRole("button", { name: "删除所选项", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.locator(".list-view__item").filter({ hasText: taskNames[0] })).toHaveCount(0);
  await expect(page.locator(".list-view__item").filter({ hasText: taskNames[1] })).toHaveCount(0);
  const remaining = await page.request.get(`/api/tasks?status=archived&q=Bulk%20archived&page=1&pageSize=50`).then((response) => response.json());
  expect(remaining.total).toBe(0);
  expect(await page.request.get(`/api/tasks?status=active&q=${encodeURIComponent(taskNames[2])}`).then((response) => response.json()).then((result) => result.total)).toBe(1);
});

test("list responses taking six seconds complete without polling starvation", async ({ page }) => {
  await login(page);
  const created = await page.request.post("/api/tasks", { data: {
    name: "Slow response task", startsAt: "2030-11-04T09:00:00+08:00", preset: "daily", cron: "0 9 * * *", repeatCount: 2, endDate: null,
  } });
  expect(created.status()).toBe(201);
  let requests = 0;
  await page.route("**/api/tasks?**", async (route) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 6100));
    await route.fulfill({ response: await route.fetch() });
  });
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "编辑 Slow response task", exact: true })).toBeVisible({ timeout: 12_000 });
  expect(requests).toBe(1);
});

test("settings edits made while saving remain unsaved until the next save", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByText("更多通知选项", { exact: true }).click();
  const group = page.getByLabel("默认通知分组", { exact: true });
  await group.fill("Submitted group");
  let release!: () => void;
  let received!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { received = resolve; });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") { received(); await pending; }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "保存偏好", exact: true }).click();
    await started;
    await group.fill("Newer local edit");
    release();
    await expect(page.getByText("通知偏好已保存。", { exact: true })).toBeVisible();
    await expect(group).toHaveValue("Newer local edit");
    await expect(page.getByRole("button", { name: "保存偏好", exact: true })).toBeEnabled();
    expect((await (await page.request.get("/api/settings")).json()).settings.group).toBe("Submitted group");
    await page.getByRole("button", { name: "保存偏好", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存偏好", exact: true })).toBeDisabled();
    expect((await (await page.request.get("/api/settings")).json()).settings.group).toBe("Newer local edit");
  } finally { release(); }
});

test("closing a changed mobile task editor requires discarding its contents", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "新建提醒", exact: true }).last().click();
  await page.getByLabel("提醒名称", { exact: true }).fill("尚未保存的提醒");
  await page.getByRole("button", { name: "关闭编辑器", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("提醒名称", { exact: true })).toHaveValue("尚未保存的提醒");
  await page.screenshot({ path: test.info().outputPath("mobile-editor.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "关闭编辑器", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("heading", { name: "新建提醒", exact: true })).toBeHidden();
});
