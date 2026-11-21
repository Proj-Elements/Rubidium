import { expect, test } from "@playwright/test";

test("logout is a prominent landscape action with explicit confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();

  const logout = page.getByRole("button", { name: "退出登录", exact: true });
  await expect(logout).toBeVisible();
  expect(await logout.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await logout.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("logout-confirm-landscape.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await logout.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录工作空间" })).toBeVisible();
});
