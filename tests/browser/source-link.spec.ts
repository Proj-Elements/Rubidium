import { expect, test } from "@playwright/test";

test("AGPL source is reachable from the login gate and authenticated sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  const gateLink = page.getByRole("link", { name: "获取 Rubidium 源码" });
  await expect(gateLink).toHaveAttribute("href", "https://github.com/Proj-Elements/Rubidium");
  await expect(gateLink).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("source-link-login-landscape.png"), animations: "disabled" });

  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  const sidebar = page.getByRole("complementary").getByRole("link", { name: "获取 Rubidium 源码" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute("target", "_blank");
  await page.screenshot({ path: test.info().outputPath("source-link-workspace-landscape.png"), animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  const mobileSidebar = page.getByRole("dialog", { name: "工作空间导航" }).getByRole("link", { name: "获取 Rubidium 源码" });
  await expect(mobileSidebar).toBeVisible();
  await expect(mobileSidebar).toBeInViewport({ ratio: 1 });
});
