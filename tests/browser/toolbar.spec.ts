import { expect, test } from "@playwright/test";

test("new reminder action has a leading plus and landscape touch size", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();

  const create = page.getByRole("button", { name: "新建提醒", exact: true });
  await expect(create.locator("svg")).toBeVisible();
  expect(await create.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await create.click();
  await expect(page.getByRole("heading", { name: "新建提醒" })).toBeVisible();
});
