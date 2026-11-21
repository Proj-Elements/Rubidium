import { expect, test } from "@playwright/test";

test("delivery status filter is framed and stays right-aligned in landscape", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await page.goto("/deliveries");

  const search = page.getByRole("searchbox", { name: "搜索记录" });
  const filter = page.getByRole("button", { name: /全部记录/ });
  await expect(search).toBeVisible();
  await expect(filter).toBeVisible();
  const [searchBox, filterBox] = await Promise.all([search.boundingBox(), filter.boundingBox()]);
  expect(searchBox).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(filterBox!.x).toBeGreaterThan(searchBox!.x);
  expect(filterBox!.height).toBeGreaterThanOrEqual(44);
  expect(await filter.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("1px");
  await filter.click();
  await page.getByRole("option", { name: "待投递", exact: true }).click();
  await expect(page.getByRole("button", { name: /待投递/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("delivery-filter-landscape.png"), fullPage: true, animations: "disabled" });
});
