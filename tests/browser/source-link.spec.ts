import { expect, test } from "@playwright/test";

test("source repository links are absent from the login gate and workspace navigation", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  const sourceLinks = page.locator('a[href="https://github.com/Proj-Elements/Rubidium"]');
  await expect(sourceLinks).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "登录工作空间" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("source-link-login-landscape.png"), animations: "disabled" });

  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(sourceLinks).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("source-link-workspace-landscape.png"), animations: "disabled" });

  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(sourceLinks).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.getByRole("dialog", { name: "工作空间导航" })).toBeVisible();
  await expect(sourceLinks).toHaveCount(0);
});
