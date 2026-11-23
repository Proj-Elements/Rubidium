import { expect, test } from "@playwright/test";

test("logout is a prominent landscape action with explicit confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();

  const logout = page.getByRole("button", { name: "退出登录", exact: true });
  await expect(logout).toBeVisible();
  expect(await logout.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 568, height: 320 });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  const mobileNavigation = page.getByRole("dialog", { name: "工作空间导航" });
  const mobileLogout = mobileNavigation.getByRole("button", { name: "退出登录", exact: true });
  await expect(mobileLogout).toBeInViewport();
  const navigationBounds = (await mobileNavigation.boundingBox())!;
  const logoutBounds = (await mobileLogout.boundingBox())!;
  expect(navigationBounds.y + navigationBounds.height - logoutBounds.y - logoutBounds.height).toBeGreaterThanOrEqual(20);
  await page.screenshot({ path: test.info().outputPath("logout-mobile-bottom-space.png"), animations: "disabled" });
  await mobileNavigation.getByRole("button", { name: "关闭导航", exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await logout.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("logout-confirm-landscape.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await logout.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录工作空间" })).toBeVisible();
});
