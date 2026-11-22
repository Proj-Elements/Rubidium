import { expect, test } from "@playwright/test";

test("first-visit setup stays usable in touch landscape and confirms the password", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let setupPayload: unknown;
  await page.route("**/api/session", async (route) => {
    if (route.request().method() === "POST") {
      setupPayload = route.request().postDataJSON();
      await route.fulfill({ json: { authenticated: true, initialized: true, setupEnabled: false, setupTokenRequired: false } });
      return;
    }
    await route.fulfill({ json: { authenticated: false, initialized: false, setupEnabled: true, setupTokenRequired: true } });
  });
  await page.route("**/api/overview", (route) => route.fulfill({ json: {
    tasks: [], upcoming: [], upcomingDays: [], deviceKeyConfigured: false, defaultChannel: { type: "bark", credentialConfigured: false }, endpoint: "https://api.day.app",
    deliveries: { pending: 0, retrying: 0, nextRetryAt: null },
    stats: { active: 0, paused: 0, todaySent: 0, totalSent: 0 }, activity: [], recent: [], serverTime: new Date().toISOString(),
  } }));

  for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "创建访问密码" })).toBeVisible();
    if (viewport.width === 844) {
      await page.getByRole("button", { name: "选择语言" }).click();
      await page.getByRole("menuitem", { name: "English", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Create an access password" })).toBeVisible();
      await page.getByRole("button", { name: "Choose language" }).click();
      await page.getByRole("menuitem", { name: "简体中文", exact: true }).click();
      await expect(page.getByRole("heading", { name: "创建访问密码" })).toBeVisible();
    }
    await expect(page.getByLabel("设置访问密码")).toBeVisible();
    await expect(page.getByLabel("确认访问密码")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controls = [
      page.getByLabel("部署引导令牌"),
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
    await expect(page.locator('a[href="https://github.com/Proj-Elements/Rubidium"]')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`setup-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
  }

  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto("/");
  await page.getByLabel("部署引导令牌").fill("browser-bootstrap-token-secret-2030");
  await page.getByLabel("设置访问密码").fill("landscape-setup-password-2030");
  await expect(page.getByText("请再次输入密码以确认")).toBeVisible();
  await page.getByLabel("确认访问密码").fill("different-password-value");
  await expect(page.getByText("两次输入的密码不一致")).toBeVisible();
  await expect(page.getByRole("button", { name: "完成初始化" })).toBeDisabled();
  await page.getByLabel("确认访问密码").fill("landscape-setup-password-2030");
  const timeZoneTrigger = page.getByRole("button", { name: /Asia\/Shanghai/ });
  await timeZoneTrigger.click();
  const popover = page.locator(".select__popover:visible").last();
  const popoverBounds = await popover.boundingBox();
  expect(popoverBounds).not.toBeNull();
  expect(popoverBounds!.y).toBeGreaterThanOrEqual(0);
  expect(popoverBounds!.y + popoverBounds!.height).toBeLessThanOrEqual(320);
  const timeZones = page.getByRole("listbox");
  const firstOption = page.getByRole("option").first();
  expect(await firstOption.evaluate((element) => getComputedStyle(element).minHeight)).toBe("44px");
  await expect.poll(async () => (await firstOption.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const firstOptionBounds = await firstOption.boundingBox();
  expect(firstOptionBounds).not.toBeNull();
  expect(firstOptionBounds!.height).toBeGreaterThanOrEqual(44);
  expect(await timeZones.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await timeZones.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await timeZones.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const search = page.getByRole("searchbox", { name: "搜索时区" });
  await search.fill("Europe/Paris");
  const paris = page.getByRole("option", { name: /^Europe\/Paris · UTC/ });
  await paris.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Europe\/Paris/ })).toBeVisible();
  await page.getByRole("button", { name: "完成初始化" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
  expect(setupPayload).toEqual({ mode: "setup", password: "landscape-setup-password-2030", timeZone: "Europe/Paris", setupToken: "browser-bootstrap-token-secret-2030" });
});

test("first-run setup stays closed without deployment authorization", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({ json: {
    authenticated: false, initialized: false, setupEnabled: false, setupTokenRequired: false,
  } }));
  await page.goto("/");
  await expect(page.getByText(/首次初始化未启用/)).toBeVisible();
  await expect(page.getByLabel("设置访问密码")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "完成初始化" })).toHaveCount(0);
});
