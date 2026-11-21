import { expect, test } from "@playwright/test";

test("first-visit setup stays usable in touch landscape and confirms the password", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/session", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ mode: "setup", password: "landscape-setup-password-2030" });
      await route.fulfill({ json: { authenticated: true, initialized: true } });
      return;
    }
    await route.fulfill({ json: { authenticated: false, initialized: false } });
  });

  for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "创建访问密码" })).toBeVisible();
    await expect(page.getByLabel("设置访问密码")).toBeVisible();
    await expect(page.getByLabel("确认访问密码")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const buttons = await page.getByRole("button", { name: "完成初始化" }).evaluate((button) => button.getBoundingClientRect().height);
    expect(buttons).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath(`setup-${viewport.width}x${viewport.height}.png`), fullPage: true, animations: "disabled" });
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("设置访问密码").fill("landscape-setup-password-2030");
  await page.getByLabel("确认访问密码").fill("different-password-value");
  await expect(page.getByText("两次输入的密码不一致")).toBeVisible();
  await expect(page.getByRole("button", { name: "完成初始化" })).toBeDisabled();
  await page.getByLabel("确认访问密码").fill("landscape-setup-password-2030");
  await page.getByRole("button", { name: "完成初始化" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
});
