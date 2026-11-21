import { expect, test } from "@playwright/test";

test("first-visit setup stays usable in touch landscape and confirms the password", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let setupPayload: unknown;
  await page.route("**/api/session", async (route) => {
    if (route.request().method() === "POST") {
      setupPayload = route.request().postDataJSON();
      await route.fulfill({ json: { authenticated: true, initialized: true } });
      return;
    }
    await route.fulfill({ json: { authenticated: false, initialized: false } });
  });
  await page.route("**/api/overview", (route) => route.fulfill({ json: {
    tasks: [], upcoming: [], upcomingDays: [], deviceKeyConfigured: false, endpoint: "https://api.day.app",
    deliveries: { pending: 0, retrying: 0, nextRetryAt: null },
    stats: { active: 0, paused: 0, todaySent: 0, totalSent: 0 }, activity: [], recent: [], serverTime: new Date().toISOString(),
  } }));

  for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "创建访问密码" })).toBeVisible();
    await expect(page.getByLabel("设置访问密码")).toBeVisible();
    await expect(page.getByLabel("确认访问密码")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controls = [
      page.getByLabel("设置访问密码"),
      page.getByLabel("确认访问密码"),
      page.getByRole("button", { name: /Asia\/Shanghai/ }),
      page.getByRole("button", { name: "完成初始化" }),
    ];
    for (const control of controls) {
      const bounds = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      });
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    const cardBounds = await page.locator(".gate-card").evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    expect(cardBounds.top).toBeGreaterThanOrEqual(0);
    expect(cardBounds.bottom).toBeLessThanOrEqual(viewport.height);
    const sourceBottom = await page.getByRole("link", { name: "获取 Rubidium 源码" }).evaluate((link) => link.getBoundingClientRect().bottom);
    if (viewport.height >= 24 * 16) expect(sourceBottom).toBeLessThanOrEqual(viewport.height);
    else if (sourceBottom > viewport.height) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(viewport.height);
    await page.screenshot({ path: test.info().outputPath(`setup-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("设置访问密码").fill("landscape-setup-password-2030");
  await page.getByLabel("确认访问密码").fill("different-password-value");
  await expect(page.getByText("两次输入的密码不一致")).toBeVisible();
  await expect(page.getByRole("button", { name: "完成初始化" })).toBeDisabled();
  await page.getByLabel("确认访问密码").fill("landscape-setup-password-2030");
  await page.getByRole("button", { name: /时区$/ }).click();
  await page.getByRole("searchbox", { name: "搜索时区" }).fill("Paris");
  await page.getByRole("option", { name: "Europe/Paris", exact: true }).click();
  await expect(page.getByRole("button", { name: /Europe\/Paris/ })).toBeVisible();
  await page.getByRole("button", { name: "完成初始化" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
  expect(setupPayload).toEqual({ mode: "setup", password: "landscape-setup-password-2030", timeZone: "Europe/Paris" });
});
